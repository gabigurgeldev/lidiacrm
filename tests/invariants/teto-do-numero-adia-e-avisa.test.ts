import { beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import type * as InboundTurn from "@/lib/agent-engine/agent/inbound-turn";
import type * as Providers from "@/lib/agent-engine/edge/llm/providers";
import type * as Queue from "@/lib/agent-engine/queue/queue";
import type * as ObsLogger from "@/lib/agent-engine/obs/logger";

/**
 * O TETO DO DIA DO NÚMERO NÃO CALA O AGENTE.
 *
 * ─── O defeito ─────────────────────────────────────────────────────────────
 *
 * O aquecimento anti-ban limita os envios por dia em degraus de idade do número
 * (20 → 50 → 100 → 200 → sem teto). A idade vinha SÓ de
 * `channel_knobs.number_activated_at`, linha que nasce quando alguém salva a tela
 * de Proteção de envio. Sem ela, idade 0 para sempre: 20 envios/dia num número
 * de meses. E, batido o teto, o veto voltava ao modelo como erro de ensino — o
 * turno terminava "ok" com zero envios, sem reagendamento e sem aviso. O
 * cliente que escrevesse depois da 20ª mensagem do dia não recebia nada.
 *
 * ─── O que cada caso guarda (e como foi sabotado) ──────────────────────────
 *
 *  1. Número conectado há 40 dias, SEM linha de knobs, com 25 envios hoje: o
 *     agente responde. Sabotagem: voltar `loadChannelKnobs` a ler só
 *     `channel_knobs` (idade 0) → o turno é adiado e o caso reprova.
 *  2. Número conectado ontem, já com 20 envios hoje: o turno é ADIADO antes de
 *     chamar o modelo, o job volta a `pending` com `run_after` no futuro, e a
 *     Central recebe `teto_do_numero`. Sabotagem: tirar a pré-checagem de
 *     `inbound-turn.ts` → o modelo é chamado, nada sai, o turno termina "ok".
 *  3. O teto estoura NO MEIO do turno (o modelo fake grava 20 envios no ledger
 *     antes de pedir o `send_message` — a corrida com outro turno do mesmo
 *     número): nada sai, e o turno é adiado em vez de fechar mudo. Sabotagem:
 *     tirar o bloco `tetoNoEnvio` → o job termina `done` sem envio.
 *
 * Harness igual ao de `janela-usa-o-relogio-injetado.test.ts`: handler real,
 * modelo fake, canal que CAPTURA, relógio fixo dentro da janela. Cada caso tem
 * número, contato e conversa próprios — o teto é por número, e um caso não pode
 * gastar o teto do outro.
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

const ORG = "eeeeeeee-0000-4000-8000-000000000001";

/** Terça, 15h BRT — dentro da janela anti-ban padrão (7h–22h). */
const AGORA = new Date("2026-07-28T18:00:00Z");
const DIA_MS = 86_400_000;

interface Cenario {
  contato: string;
  sessao: string;
  conversa: string;
  mensagem: string;
  evento: string;
}

function cenario(n: number): Cenario {
  const sufixo = String(n).padStart(2, "0");
  return {
    contato: `eeeeeeee-0000-4000-8000-0000000001${sufixo}`,
    sessao: `eeeeeeee-0000-4000-8000-0000000002${sufixo}`,
    conversa: `eeeeeeee-0000-4000-8000-0000000003${sufixo}`,
    mensagem: `eeeeeeee-0000-4000-8000-0000000004${sufixo}`,
    evento: `eeeeeeee-0000-4000-8000-0000000005${sufixo}`,
  };
}

const NUMERO_ANTIGO = cenario(1);
const NUMERO_NOVO_NO_TETO = cenario(2);
const TETO_NO_MEIO = cenario(3);

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

/**
 * Modelo fake que manda UMA mensagem e encerra. Conta as chamadas, e roda
 * `antesDeMandar` na primeira — é por ali que o caso 3 provoca a corrida.
 */
function modeloQueManda(rotulo: string, antesDeMandar?: () => Promise<void>) {
  const estado = { chamadas: 0 };
  let mandou = false;
  const doGenerate = async () => {
    estado.chamadas += 1;
    if (!mandou) {
      mandou = true;
      await antesDeMandar?.();
      return {
        content: [
          {
            type: "tool-call" as const,
            toolCallId: "c1",
            toolName: "send_message",
            input: JSON.stringify({ body: `oi, tudo bem? (${rotulo})` }),
          },
        ],
        finishReason: { unified: "tool-calls" as const, raw: undefined },
        usage: USO,
        warnings: [],
      };
    }
    return {
      content: [{ type: "text" as const, text: CHECKPOINT }],
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

async function rodaTurno(
  c: Cenario,
  handler: ReturnType<typeof montaHandler>,
): Promise<{ erro: Error | null; jobId: string }> {
  await pool.query("update job_queue set status = 'done' where status = 'pending'");
  const { job } = await m.queue.enqueueJob(pool, ORG, {
    kind: "inbound_turn",
    leadId: c.contato,
    payload: {
      conversation_id: c.conversa,
      contact_id: c.contato,
      channel_session_id: c.sessao,
      inbound_message_id: c.mensagem,
      crm_event_id: c.evento,
    },
    maxAttempts: 1,
  });
  const [claimed] = await m.queue.claimJobs(pool, { workerId: "teto", maxConcurrency: 1 });
  expect(claimed?.id).toBe(job.id);
  try {
    await handler(claimed!, pool, { workerId: "teto" });
    await m.queue.completeJob(pool, claimed!.id, "teto");
    return { erro: null, jobId: job.id };
  } catch (err) {
    await m.queue.failJob(pool, claimed!.id, "teto", err);
    return { erro: err as Error, jobId: job.id };
  }
}

/** `n` envios do número hoje (uma hora antes de AGORA, mesmo dia local). */
async function gastaEnviosDeHoje(sessao: string, n: number): Promise<void> {
  await pool.query(
    `insert into pacing_ledger (organization_id, channel_session_id, sent_at)
     select $1, $2, $3::timestamptz - (g * interval '1 second')
       from generate_series(1, $4) g`,
    [ORG, sessao, new Date(AGORA.getTime() - 3_600_000), n],
  );
}

async function semeiaCenario(c: Cenario, conectadoHaDias: number, rotulo: string): Promise<void> {
  await pool.query(
    `insert into contacts (id, organization_id, name, phone_number)
     values ($1,$2,$3,$4) on conflict (id) do nothing`,
    [c.contato, ORG, `Lead ${rotulo}`, `+55119000${c.contato.slice(-5).replace(/\D/g, "0")}`],
  );
  await pool.query(
    `insert into channel_sessions (id, organization_id, waha_session_name, status,
       webhook_secret_encrypted, created_at)
     values ($1,$2,$3,'WORKING','\\x00'::bytea, $4) on conflict (id) do nothing`,
    [c.sessao, ORG, `teto-${rotulo}`, new Date(AGORA.getTime() - conectadoHaDias * DIA_MS)],
  );
  await pool.query(
    `insert into conversations (id, organization_id, contact_id, channel_session_id, status, is_group)
     values ($1,$2,$3,$4,'ai_handling',false) on conflict (id) do nothing`,
    [c.conversa, ORG, c.contato, c.sessao],
  );
  await pool.query(
    `insert into messages (id, organization_id, conversation_id, channel_session_id, contact_id,
       type, direction, status, body, sent_via, sent_at)
     values ($1,$2,$3,$4,$5,'text','inbound','delivered','Oi','external_device', now())
     on conflict (id) do nothing`,
    [c.mensagem, ORG, c.conversa, c.sessao, c.contato],
  );
}

async function avisosDoTeto(sessao: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `select count(*) as n from agent_inbox_items
      where organization_id = $1 and kind = 'teto_do_numero' and ref_id = $2 and status = 'open'`,
    [ORG, sessao],
  );
  return Number(rows[0]?.n ?? 0);
}

async function estadoDoJob(jobId: string): Promise<{ status: string; adiado: boolean }> {
  const { rows } = await pool.query<{ status: string; adiado: boolean }>(
    `select status, run_after > now() as adiado from job_queue where id = $1`,
    [jobId],
  );
  return rows[0]!;
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
     values ($1,'teto-do-numero','Teto do Numero','Teto do Numero') on conflict (id) do nothing`,
    [ORG],
  );
  await semeiaCenario(NUMERO_ANTIGO, 40, "antigo");
  await semeiaCenario(NUMERO_NOVO_NO_TETO, 1, "novo");
  await semeiaCenario(TETO_NO_MEIO, 1, "meio");
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

describe("o teto do dia do número não cala o agente", () => {
  it("número conectado há 40 dias, sem tela de ritmo salva, responde depois da 20ª mensagem", async () => {
    await gastaEnviosDeHoje(NUMERO_ANTIGO.sessao, 25);
    const enviados: string[] = [];
    const { doGenerate } = modeloQueManda("antigo");

    const { erro } = await rodaTurno(NUMERO_ANTIGO, montaHandler(doGenerate, enviados));

    expect(erro).toBeNull();
    expect(enviados).toHaveLength(1);
    expect(await avisosDoTeto(NUMERO_ANTIGO.sessao)).toBe(0);
  });

  it("número novo que já bateu o teto: adia ANTES do modelo, reagenda e avisa", async () => {
    await gastaEnviosDeHoje(NUMERO_NOVO_NO_TETO.sessao, 20);
    const enviados: string[] = [];
    const { doGenerate, estado } = modeloQueManda("novo");

    const { erro, jobId } = await rodaTurno(NUMERO_NOVO_NO_TETO, montaHandler(doGenerate, enviados));

    expect(String(erro?.message)).toMatch(/teto do dia do número atingido/);
    expect(estado.chamadas).toBe(0);
    expect(enviados).toHaveLength(0);
    expect(await estadoDoJob(jobId)).toEqual({ status: "pending", adiado: true });
    expect(await avisosDoTeto(NUMERO_NOVO_NO_TETO.sessao)).toBe(1);
  });

  it("teto que estoura no meio do turno: nada sai, e o turno é adiado em vez de fechar mudo", async () => {
    const enviados: string[] = [];
    const { doGenerate } = modeloQueManda("meio", () => gastaEnviosDeHoje(TETO_NO_MEIO.sessao, 20));

    const { erro, jobId } = await rodaTurno(TETO_NO_MEIO, montaHandler(doGenerate, enviados));

    expect(String(erro?.message)).toMatch(/teto do dia do número atingido no envio/);
    expect(enviados).toHaveLength(0);
    expect(await estadoDoJob(jobId)).toEqual({ status: "pending", adiado: true });
    expect(await avisosDoTeto(TETO_NO_MEIO.sessao)).toBe(1);
  });
});
