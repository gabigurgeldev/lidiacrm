import { beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import type * as InboundTurn from "@/lib/agent-engine/agent/inbound-turn";
import type * as Providers from "@/lib/agent-engine/edge/llm/providers";
import type * as Queue from "@/lib/agent-engine/queue/queue";
import type * as ObsLogger from "@/lib/agent-engine/obs/logger";

/**
 * O CLIENTE QUE ESCREVEU RECEBE RESPOSTA — OU ALGUÉM FICA SABENDO.
 *
 * ─── Os defeitos ───────────────────────────────────────────────────────────
 *
 * 1. O modelo escrevia a resposta como TEXTO, sem chamar `send_message`. O
 *    runtime descarta texto solto de propósito, então o turno terminava "ok",
 *    zero envios, `messages_sent: 0` em nível info — e o cliente sem nada.
 * 2. O checkpoint (o resumo pedido DEPOIS da resposta) era lido fora do
 *    melhor-esforço: JSON malformado lançava, o job falhava e o turno inteiro,
 *    com todas as chamadas de modelo, era refeito — por um resumo.
 *
 * ─── O que cada caso guarda (e a sabotagem medida) ─────────────────────────
 *
 *  - "cobrado, responde": 1ª chamada devolve prosa; a cobrança (2ª) chama
 *    `send_message`. Sabotagem: tirar o bloco de resgate → 0 envios, reprova.
 *  - "cobrado, segue calado": prosa nas duas → nada sai, o job NÃO falha, e
 *    abre `turno_sem_resposta`. Sabotagem: tirar `avisarTurnoSemResposta` →
 *    nenhum aviso, reprova.
 *  - "checkpoint malformado": envia, e o fechamento devolve prosa → o job
 *    termina sem erro. Sabotagem: devolver o `parseCheckpointText` para fora do
 *    try → o turno lança, reprova.
 *
 * Harness de `janela-usa-o-relogio-injetado.test.ts`. Cada caso tem contato e
 * conversa próprios: o aviso é deduplicado por contato, e o gate de spinning
 * veta corpo repetido no mesmo número.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://placeholder.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "placeholder-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "placeholder-service";

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 2,
});

const ORG = "f2f2f2f2-0000-4000-8000-000000000001";
const SESSION = "f2f2f2f2-0000-4000-8000-000000000002";
/** Terça, 15h BRT — dentro da janela anti-ban. */
const AGORA = new Date("2026-07-28T18:00:00Z");

interface Cenario {
  contato: string;
  conversa: string;
  mensagem: string;
  evento: string;
}

function cenario(n: number): Cenario {
  const s = String(n).padStart(2, "0");
  return {
    contato: `f2f2f2f2-0000-4000-8000-0000000001${s}`,
    conversa: `f2f2f2f2-0000-4000-8000-0000000002${s}`,
    mensagem: `f2f2f2f2-0000-4000-8000-0000000003${s}`,
    evento: `f2f2f2f2-0000-4000-8000-0000000004${s}`,
  };
}

const COBRADO_RESPONDE = cenario(1);
const COBRADO_CALADO = cenario(2);
const CHECKPOINT_RUIM = cenario(3);

type Modules = {
  createInboundTurnHandler: typeof InboundTurn.createInboundTurnHandler;
  queue: typeof Queue;
  createLogger: typeof ObsLogger.createLogger;
  createFakeRegistry: typeof Providers.createFakeRegistry;
};
let m: Modules;

const CHECKPOINT = JSON.stringify({
  commitments: [],
  objections: [],
  next_action: null,
  rolling_summary: "turno de teste",
});

const USO = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

type Resposta = { texto: string } | { envia: string };

/** Modelo fake com roteiro: a N-ésima chamada devolve a N-ésima resposta (a última se repete). */
function modeloComRoteiro(roteiro: Resposta[]) {
  const estado = { chamadas: 0 };
  const doGenerate = async () => {
    const r = roteiro[Math.min(estado.chamadas, roteiro.length - 1)]!;
    estado.chamadas += 1;
    if ("envia" in r) {
      return {
        content: [
          {
            type: "tool-call" as const,
            toolCallId: `c${estado.chamadas}`,
            toolName: "send_message",
            input: JSON.stringify({ body: r.envia }),
          },
        ],
        finishReason: { unified: "tool-calls" as const, raw: undefined },
        usage: USO,
        warnings: [],
      };
    }
    return {
      content: [{ type: "text" as const, text: r.texto }],
      finishReason: { unified: "stop" as const, raw: undefined },
      usage: USO,
      warnings: [],
    };
  };
  return { doGenerate, estado };
}

function montaHandler(doGenerate: unknown, enviados: string[]) {
  return m.createInboundTurnHandler({
    crmCfg: { supabase: {} as never },
    llmCfg: { anthropicApiKey: "fake" } as never,
    knobs: {
      historyLimit: 10,
      maxContextTokens: 1000,
      notesIndexMaxTokens: 500,
      maxSteps: 12,
      queuedRetryDelayMs: 1000,
      breaker: {
        exactFailureWarn: 2,
        exactFailureBlock: 5,
        sameToolFailureWarn: 3,
        sameToolFailureHalt: 8,
        noProgressWarn: 3,
        noProgressBlock: 5,
      },
    },
    log: m.createLogger(),
    registry: m.createFakeRegistry(doGenerate as never),
    channel: () =>
      ({
        channel: "captura",
        send: async (i: { body: string }) => {
          enviados.push(i.body);
          return {
            kind: "sent" as const,
            idempotencyKey: `k${enviados.length}-${i.body}`,
            messageId: `m${enviados.length}-${i.body}`,
          };
        },
        sessionHealth: async () => ({ healthy: true, status: "WORKING" }),
        capabilities: () => ({ freeform: true, media: true, audio: true }),
        costPerMessage: () => ({ currency: "BRL", cents: 0 }),
      }) as never,
    clock: () => AGORA,
    sleep: async () => {},
  });
}

async function rodaTurno(c: Cenario, handler: ReturnType<typeof montaHandler>): Promise<Error | null> {
  await pool.query("update job_queue set status = 'done' where status = 'pending'");
  const { job } = await m.queue.enqueueJob(pool, ORG, {
    kind: "inbound_turn",
    leadId: c.contato,
    payload: {
      conversation_id: c.conversa,
      contact_id: c.contato,
      channel_session_id: SESSION,
      inbound_message_id: c.mensagem,
      crm_event_id: c.evento,
    },
    maxAttempts: 1,
  });
  const [claimed] = await m.queue.claimJobs(pool, { workerId: "mudo", maxConcurrency: 1 });
  expect(claimed?.id).toBe(job.id);
  try {
    await handler(claimed!, pool, { workerId: "mudo" });
    await m.queue.completeJob(pool, claimed!.id, "mudo");
    return null;
  } catch (err) {
    await m.queue.failJob(pool, claimed!.id, "mudo", err);
    return err as Error;
  }
}

async function avisosSemResposta(contato: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `select count(*) as n from agent_inbox_items
      where organization_id = $1 and kind = 'turno_sem_resposta' and ref_id = $2 and status = 'open'`,
    [ORG, contato],
  );
  return Number(rows[0]?.n ?? 0);
}

async function semeia(c: Cenario, n: number): Promise<void> {
  await pool.query(
    `insert into contacts (id, organization_id, name, phone_number)
     values ($1,$2,$3,$4) on conflict (id) do nothing`,
    [c.contato, ORG, `Lead mudo ${n}`, `+551190000099${n}`],
  );
  await pool.query(
    `insert into conversations (id, organization_id, contact_id, channel_session_id, status, is_group)
     values ($1,$2,$3,$4,'ai_handling',false) on conflict (id) do nothing`,
    [c.conversa, ORG, c.contato, SESSION],
  );
  await pool.query(
    `insert into messages (id, organization_id, conversation_id, channel_session_id, contact_id,
       type, direction, status, body, sent_via, sent_at)
     values ($1,$2,$3,$4,$5,'text','inbound','delivered','Vocês têm o plano anual?','external_device', now())
     on conflict (id) do nothing`,
    [c.mensagem, ORG, c.conversa, SESSION, c.contato],
  );
}

beforeAll(async () => {
  m = {
    createInboundTurnHandler: (await import("@/lib/agent-engine/agent/inbound-turn"))
      .createInboundTurnHandler,
    queue: await import("@/lib/agent-engine/queue/queue"),
    createLogger: (await import("@/lib/agent-engine/obs/logger")).createLogger,
    createFakeRegistry: (await import("@/lib/agent-engine/edge/llm/providers")).createFakeRegistry,
  };

  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1,'turno-mudo','Turno Mudo','Turno Mudo') on conflict (id) do nothing`,
    [ORG],
  );
  await pool.query(
    `insert into channel_sessions (id, organization_id, waha_session_name, status, webhook_secret_encrypted)
     values ($1,$2,'turno-mudo-session','WORKING','\\x00'::bytea) on conflict (id) do nothing`,
    [SESSION, ORG],
  );
  await semeia(COBRADO_RESPONDE, 1);
  await semeia(COBRADO_CALADO, 2);
  await semeia(CHECKPOINT_RUIM, 3);
  await pool.query(
    `with v as (
       insert into playbook_versions (organization_id, layer, content)
       select null, 'platform', E'## Identidade\nAssistente de teste.'
       where not exists (select 1 from playbook_pointers where organization_id is null and layer = 'platform')
       returning id)
     insert into playbook_pointers (organization_id, layer, version_id)
     select null, 'platform', id from v`,
  );
});

describe("o turno que terminaria sem resposta", () => {
  it("modelo que escreveu prosa é cobrado e responde por send_message", async () => {
    const enviados: string[] = [];
    const { doGenerate } = modeloComRoteiro([
      { texto: "Temos sim, o plano anual sai mais em conta." },
      { envia: "Temos sim! O plano anual sai mais em conta. (cobrado)" },
      { texto: CHECKPOINT },
    ]);

    const erro = await rodaTurno(COBRADO_RESPONDE, montaHandler(doGenerate, enviados));

    expect(erro).toBeNull();
    expect(enviados).toHaveLength(1);
    expect(await avisosSemResposta(COBRADO_RESPONDE.contato)).toBe(0);
  });

  it("modelo que segue calado depois de cobrado: nada sai, o job não falha, e a Central fica sabendo", async () => {
    const enviados: string[] = [];
    const { doGenerate } = modeloComRoteiro([{ texto: "Temos sim, o plano anual sai mais em conta." }]);

    const erro = await rodaTurno(COBRADO_CALADO, montaHandler(doGenerate, enviados));

    expect(erro).toBeNull();
    expect(enviados).toHaveLength(0);
    expect(await avisosSemResposta(COBRADO_CALADO.contato)).toBe(1);
  });

  it("checkpoint malformado depois da resposta não refaz o turno", async () => {
    const enviados: string[] = [];
    const { doGenerate } = modeloComRoteiro([
      { envia: "Temos sim! (checkpoint ruim)" },
      { texto: "pronto, respondi." },
      { texto: "isto não é o JSON do checkpoint" },
    ]);

    const erro = await rodaTurno(CHECKPOINT_RUIM, montaHandler(doGenerate, enviados));

    expect(erro).toBeNull();
    expect(enviados).toHaveLength(1);
  });
});
