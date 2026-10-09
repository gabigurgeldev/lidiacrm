import { beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import type * as InboundTurn from "@/lib/agent-engine/agent/inbound-turn";
import type * as Providers from "@/lib/agent-engine/edge/llm/providers";
import type * as ObsLogger from "@/lib/agent-engine/obs/logger";
import type * as Queue from "@/lib/agent-engine/queue/queue";

/**
 * EXECUÇÕES DO AGENTE MOSTRAM O ATENDIMENTO REAL.
 *
 * A aba Execuções lê `ai_agent_runs`, e o motor vivo nunca escrevia ali: a aba
 * ficava vazia com o agente respondendo. Pelo handler de produção:
 *
 *  1. Turno respondido ⇒ UMA linha `completed`, com agente, versão, mensagem
 *     de entrada, os passos e a chamada a `send_message` no trace, e os tokens
 *     somados de `llm_calls` do job.
 *  2. Turno fora do horário de funcionamento ⇒ UMA linha `aborted` com
 *     `abort_reason = 'fora_do_horario'`, e o job reagendado (não falhou).
 *
 * Sabotagens descritas (o Postgres de teste só sobe no CI): tirar o
 * `gravarRegistroDoTurno` do `finally` de `runAgentTurn` ⇒ zero linhas nos dois
 * casos; tirar `input.registro.motivo = 'fora_do_horario'` ⇒ caso 2 com
 * `abort_reason = 'adiado'`.
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

const ORG = "f8f8f8f8-0000-4000-8000-000000000001";
const SESSION_ABERTA = "f8f8f8f8-0000-4000-8000-000000000002";
const SESSION_FECHADA = "f8f8f8f8-0000-4000-8000-000000000003";
const AGENTE = "f8f8f8f8-0000-4000-8000-000000000011";
const AGENTE_V = "f8f8f8f8-0000-4000-8000-000000000012";
const AGENTE_FECHADO = "f8f8f8f8-0000-4000-8000-000000000021";
const AGENTE_FECHADO_V = "f8f8f8f8-0000-4000-8000-000000000022";
/** Terça, 15h BRT — dentro da janela anti-ban. */
const AGORA = new Date("2026-07-28T18:00:00Z");

interface Cenario {
  contato: string;
  conversa: string;
  mensagem: string;
  evento: string;
  sessao: string;
}

function cenario(n: number, sessao: string): Cenario {
  const s = String(n).padStart(2, "0");
  return {
    contato: `f8f8f8f8-0000-4000-8000-0000000001${s}`,
    conversa: `f8f8f8f8-0000-4000-8000-0000000002${s}`,
    mensagem: `f8f8f8f8-0000-4000-8000-0000000003${s}`,
    evento: `f8f8f8f8-0000-4000-8000-0000000004${s}`,
    sessao,
  };
}

const RESPONDIDO = cenario(1, SESSION_ABERTA);
const FORA_DO_HORARIO = cenario(2, SESSION_FECHADA);

type Modules = {
  createInboundTurnHandler: typeof InboundTurn.createInboundTurnHandler;
  JobSettledError: typeof InboundTurn.JobSettledError;
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
  inputTokens: { total: 7, noCache: 7, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 3, text: 3, reasoning: 0 },
};

/** Responde uma vez por `send_message`; depois (e sem ferramentas) devolve o checkpoint. */
function modelo() {
  let enviou = false;
  return async (opcoes: { tools?: Array<{ name: string }> }) => {
    const ferramentas = (opcoes.tools ?? []).map((t) => t.name);
    if (!ferramentas.includes("send_message") || enviou) {
      return {
        content: [{ type: "text" as const, text: CHECKPOINT }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: USO,
        warnings: [],
      };
    }
    enviou = true;
    return {
      content: [
        {
          type: "tool-call" as const,
          toolCallId: "c1",
          toolName: "send_message",
          input: JSON.stringify({ body: "Temos sim! O plano anual sai mais em conta." }),
        },
      ],
      finishReason: { unified: "tool-calls" as const, raw: undefined },
      usage: USO,
      warnings: [],
    };
  };
}

function montaHandler(enviados: string[]) {
  return m.createInboundTurnHandler({
    crmCfg: { supabase: {} as never },
    llmCfg: { anthropicApiKey: "fake" } as never,
    knobs: {
      historyLimit: 10,
      maxContextTokens: 1000,
      notesIndexMaxTokens: 500,
      maxSteps: 4,
      queuedRetryDelayMs: 1000,
      breaker: {
        exactFailureWarn: 20,
        exactFailureBlock: 20,
        sameToolFailureWarn: 20,
        sameToolFailureHalt: 20,
        noProgressWarn: 20,
        noProgressBlock: 20,
      },
    },
    log: m.createLogger(),
    registry: m.createFakeRegistry(modelo() as never),
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

async function rodaTurno(c: Cenario, handler: ReturnType<typeof montaHandler>) {
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
  const [claimed] = await m.queue.claimJobs(pool, { workerId: "execucoes", maxConcurrency: 1 });
  expect(claimed?.id).toBe(job.id);
  try {
    await handler(claimed!, pool, { workerId: "execucoes" });
    await m.queue.completeJob(pool, claimed!.id, "execucoes");
    return { jobId: job.id, erro: null as Error | null };
  } catch (err) {
    // Contrato do worker: JobSettledError = o turno já dispôs do job (reagendou).
    if (!(err instanceof m.JobSettledError)) await m.queue.failJob(pool, claimed!.id, "execucoes", err);
    return { jobId: job.id, erro: err as Error };
  }
}

async function execucoes(c: Cenario) {
  const { rows } = await pool.query<{
    agent_id: string;
    agent_version_id: string;
    inbound_message_id: string | null;
    status: string;
    abort_reason: string | null;
    tokens_in: number;
    tokens_out: number;
    steps_count: number;
    tool_calls: Array<{ tool_name: string }>;
    is_dry_run: boolean;
    latency_ms: number | null;
  }>(
    `select agent_id, agent_version_id, inbound_message_id, status, abort_reason, tokens_in, tokens_out,
            steps_count, tool_calls, is_dry_run, latency_ms
       from ai_agent_runs where organization_id = $1 and conversation_id = $2`,
    [ORG, c.conversa],
  );
  return rows;
}

async function semeia(c: Cenario, n: number) {
  await pool.query(
    `insert into contacts (id, organization_id, name, phone_number)
     values ($1,$2,$3,$4) on conflict (id) do nothing`,
    [c.contato, ORG, `Lead execucao ${n}`, `+551190000066${n}`],
  );
  await pool.query(
    `insert into conversations (id, organization_id, contact_id, channel_session_id, status, is_group)
     values ($1,$2,$3,$4,'ai_handling',false) on conflict (id) do nothing`,
    [c.conversa, ORG, c.contato, c.sessao],
  );
  await pool.query(
    `insert into messages (id, organization_id, conversation_id, channel_session_id, contact_id,
       type, direction, status, body, sent_via, sent_at)
     values ($1,$2,$3,$4,$5,'text','inbound','delivered','Vocês têm o plano anual?','external_device', now())
     on conflict (id) do nothing`,
    [c.mensagem, ORG, c.conversa, c.sessao, c.contato],
  );
}

async function publica(agente: string, versao: string, nome: string, sessao: string, triggerConfig: unknown) {
  // `ai_agents_name_unique`: nome é único por organização.
  await pool.query(
    `insert into ai_agents (id, organization_id, name, system_prompt)
     values ($1,$2,$3,'system') on conflict (id) do nothing`,
    [agente, ORG, nome],
  );
  await pool.query(
    `insert into ai_agent_versions
       (id, organization_id, agent_id, version_number, system_prompt, provider, model,
        channel_session_id, status, trigger_config)
     values ($1,$2,$3,1,'Você atende a loja de teste.','anthropic','claude-sonnet-4-6',$4,'published',$5::jsonb)
     on conflict (id) do nothing`,
    [versao, ORG, agente, sessao, JSON.stringify(triggerConfig)],
  );
  await pool.query(`update ai_agents set published_version_id = $1 where id = $2`, [versao, agente]);
}

beforeAll(async () => {
  const inbound = await import("@/lib/agent-engine/agent/inbound-turn");
  m = {
    createInboundTurnHandler: inbound.createInboundTurnHandler,
    JobSettledError: inbound.JobSettledError,
    queue: await import("@/lib/agent-engine/queue/queue"),
    createLogger: (await import("@/lib/agent-engine/obs/logger")).createLogger,
    createFakeRegistry: (await import("@/lib/agent-engine/edge/llm/providers")).createFakeRegistry,
  };

  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1,'execucoes','Execucoes','Execucoes') on conflict (id) do nothing`,
    [ORG],
  );
  for (const [sessao, nome] of [
    [SESSION_ABERTA, "execucoes-aberta"],
    [SESSION_FECHADA, "execucoes-fechada"],
  ] as const) {
    await pool.query(
      `insert into channel_sessions (id, organization_id, waha_session_name, status, webhook_secret_encrypted)
       values ($1,$2,$3,'WORKING','\\x00'::bytea) on conflict (id) do nothing`,
      [sessao, ORG, nome],
    );
  }
  await publica(AGENTE, AGENTE_V, "Atendente", SESSION_ABERTA, {});
  // Só domingo, 8h–9h: terça 15h está fora.
  await publica(AGENTE_FECHADO, AGENTE_FECHADO_V, "Atendente do domingo", SESSION_FECHADA, {
    filters: {
      business_hours: { timezone: "America/Sao_Paulo", start: "08:00", end: "09:00", weekdays: [0] },
    },
  });
  await semeia(RESPONDIDO, 1);
  await semeia(FORA_DO_HORARIO, 2);
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

describe("Execuções do agente", () => {
  it("turno respondido grava uma linha completed, com trace e tokens de llm_calls", async () => {
    const enviados: string[] = [];
    const { jobId, erro } = await rodaTurno(RESPONDIDO, montaHandler(enviados));

    expect(erro).toBeNull();
    expect(enviados).toHaveLength(1);
    const linhas = await execucoes(RESPONDIDO);
    expect(linhas).toHaveLength(1);
    const r = linhas[0]!;
    expect(r).toMatchObject({
      agent_id: AGENTE,
      agent_version_id: AGENTE_V,
      inbound_message_id: RESPONDIDO.mensagem,
      status: "completed",
      abort_reason: null,
      is_dry_run: false,
    });
    expect(r.steps_count).toBeGreaterThanOrEqual(1);
    expect(r.tool_calls.map((t) => t.tool_name)).toContain("send_message");
    expect(r.latency_ms).not.toBeNull();

    const { rows } = await pool.query<{ i: string; o: string }>(
      `select coalesce(sum(input_tokens),0) as i, coalesce(sum(output_tokens),0) as o
         from llm_calls where organization_id = $1 and job_id = $2`,
      [ORG, jobId],
    );
    expect(Number(rows[0]!.i)).toBeGreaterThan(0);
    expect(r.tokens_in).toBe(Number(rows[0]!.i));
    expect(r.tokens_out).toBe(Number(rows[0]!.o));
  });

  it("turno fora do horário grava aborted com o motivo, e o job é reagendado", async () => {
    const enviados: string[] = [];
    const { jobId, erro } = await rodaTurno(FORA_DO_HORARIO, montaHandler(enviados));

    expect(erro).toBeInstanceOf(m.JobSettledError);
    expect(enviados).toHaveLength(0);
    const linhas = await execucoes(FORA_DO_HORARIO);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ agent_id: AGENTE_FECHADO, status: "aborted", abort_reason: "fora_do_horario" });

    const { rows } = await pool.query<{ status: string }>(`select status from job_queue where id = $1`, [jobId]);
    expect(rows[0]?.status).toBe("pending");
  });
});
