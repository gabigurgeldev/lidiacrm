import { beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import type * as InboundTurn from "@/lib/agent-engine/agent/inbound-turn";
import type * as Providers from "@/lib/agent-engine/edge/llm/providers";
import type * as ObsLogger from "@/lib/agent-engine/obs/logger";
import type * as Queue from "@/lib/agent-engine/queue/queue";

/**
 * "SÓ RESPONDER SOBRE…" ESCOLHE O AGENTE — PELO TURNO DE PRODUÇÃO.
 *
 * Dois agentes publicados no MESMO número, sem roteador: Vendas (prioridade
 * maior, filtro "preço, orçamento") e Suporte (filtro "pedido, entrega"). Antes,
 * o filtro era decorativo e Vendas atendia tudo — o motor carregava só o de
 * maior prioridade.
 *
 *  1. Rajada "oi" + "queria saber do meu PEDIDO": quem responde é Suporte, e a
 *     conversa passa a lembrar dele (`active_ai_agent_id`).
 *  2. Conversa em andamento com Suporte, mensagem fora de todo filtro ("pode
 *     ser terça?"): Suporte segue — o filtro não corta conversa no meio.
 *  3. Conversa nova, "bom dia", nenhum filtro aceita: ninguém responde, o
 *     modelo não é chamado, o job termina sem erro (não cai no genérico).
 *
 * Sabotagens descritas (o Postgres de teste só sobe no CI): trocar
 * `escolherPorAssunto` por `candidatos[0]` em `resolve-turn-agent.ts` → caso 1
 * responde como Vendas e caso 3 responde; tirar o `return` de
 * `outcome === 'fora_do_assunto'` em `inbound-turn.ts` → caso 3 chama o modelo
 * genérico; passar `emAndamentoCom: null` → caso 2 fica sem resposta.
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

const ORG = "f7f7f7f7-0000-4000-8000-000000000001";
const SESSION = "f7f7f7f7-0000-4000-8000-000000000002";
const VENDAS = "f7f7f7f7-0000-4000-8000-000000000011";
const VENDAS_V = "f7f7f7f7-0000-4000-8000-000000000012";
const SUPORTE = "f7f7f7f7-0000-4000-8000-000000000021";
const SUPORTE_V = "f7f7f7f7-0000-4000-8000-000000000022";
/** Terça, 15h BRT — dentro da janela anti-ban. */
const AGORA = new Date("2026-07-28T18:00:00Z");

interface Cenario {
  contato: string;
  conversa: string;
  evento: string;
}

function cenario(n: number): Cenario {
  const s = String(n).padStart(2, "0");
  return {
    contato: `f7f7f7f7-0000-4000-8000-0000000001${s}`,
    conversa: `f7f7f7f7-0000-4000-8000-0000000002${s}`,
    evento: `f7f7f7f7-0000-4000-8000-0000000004${s}`,
  };
}

const PEDIDO = cenario(1);
const EM_ANDAMENTO = cenario(2);
const BOM_DIA = cenario(3);

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

let sequencia = 0;
const FRASES = [
  "Claro, já estou olhando o andamento do seu pedido aqui.",
  "Terça funciona sim, deixo reservado para a manhã.",
  "Que bom falar com você, conta mais um pouquinho do que precisa.",
];

/**
 * Modelo que diz QUEM está falando: lê o prompt da chamada, acha o marcador do
 * prompt do agente, e envia uma mensagem com ele. Sem ferramentas, é o checkpoint.
 */
function modeloQueSeIdentifica() {
  const estado = { chamadas: 0 };
  const doGenerate = async (opcoes: { prompt?: unknown; tools?: Array<{ name: string }> }) => {
    estado.chamadas += 1;
    const ferramentas = (opcoes.tools ?? []).map((t) => t.name);
    const prompt = JSON.stringify(opcoes.prompt ?? "");
    if (!ferramentas.includes("send_message") || prompt.includes("[ja-respondi]")) {
      return {
        content: [{ type: "text" as const, text: CHECKPOINT }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: USO,
        warnings: [],
      };
    }
    const quem = prompt.includes("MARCA-SUPORTE") ? "suporte" : prompt.includes("MARCA-VENDAS") ? "vendas" : "generico";
    return {
      content: [
        {
          type: "tool-call" as const,
          toolCallId: `c${estado.chamadas}`,
          toolName: "send_message",
          // Corpo bem diferente por turno: o gate de spinning veta corpo
          // parecido (Jaccard >= 0,8) no mesmo número.
          input: JSON.stringify({ body: `[${quem}] ${FRASES[(sequencia += 1) % FRASES.length]} [ja-respondi]` }),
        },
      ],
      finishReason: { unified: "tool-calls" as const, raw: undefined },
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
  const { rows } = await pool.query<{ id: string }>(
    `select id from messages where organization_id = $1 and conversation_id = $2 and direction = 'inbound'
      order by sent_at desc limit 1`,
    [ORG, c.conversa],
  );
  const { job } = await m.queue.enqueueJob(pool, ORG, {
    kind: "inbound_turn",
    leadId: c.contato,
    payload: {
      conversation_id: c.conversa,
      contact_id: c.contato,
      channel_session_id: SESSION,
      inbound_message_id: rows[0]!.id,
      crm_event_id: c.evento,
    },
    maxAttempts: 1,
  });
  const [claimed] = await m.queue.claimJobs(pool, { workerId: "assunto", maxConcurrency: 1 });
  expect(claimed?.id).toBe(job.id);
  try {
    await handler(claimed!, pool, { workerId: "assunto" });
    await m.queue.completeJob(pool, claimed!.id, "assunto");
    return null;
  } catch (err) {
    await m.queue.failJob(pool, claimed!.id, "assunto", err);
    return err as Error;
  }
}

async function semeia(c: Cenario, n: number, falas: Array<{ direcao: "inbound" | "outbound"; texto: string; minutosAtras: number }>) {
  await pool.query(
    `insert into contacts (id, organization_id, name, phone_number)
     values ($1,$2,$3,$4) on conflict (id) do nothing`,
    [c.contato, ORG, `Lead assunto ${n}`, `+551190000077${n}`],
  );
  await pool.query(
    `insert into conversations (id, organization_id, contact_id, channel_session_id, status, is_group)
     values ($1,$2,$3,$4,'ai_handling',false) on conflict (id) do nothing`,
    [c.conversa, ORG, c.contato, SESSION],
  );
  for (const f of falas) {
    await pool.query(
      `insert into messages (organization_id, conversation_id, channel_session_id, contact_id,
         type, direction, status, body, sent_via, sent_at)
       values ($1,$2,$3,$4,'text',$5,'delivered',$6,'external_device', $7::timestamptz - make_interval(mins => $8))`,
      [ORG, c.conversa, SESSION, c.contato, f.direcao, f.texto, AGORA.toISOString(), f.minutosAtras],
    );
  }
}

async function agenteDaConversa(c: Cenario): Promise<string | null> {
  const { rows } = await pool.query<{ active_ai_agent_id: string | null }>(
    `select active_ai_agent_id from conversations where organization_id = $1 and id = $2`,
    [ORG, c.conversa],
  );
  return rows[0]?.active_ai_agent_id ?? null;
}

async function publica(agente: string, versao: string, nome: string, prioridade: number, marca: string, filtro: string) {
  await pool.query(
    `insert into ai_agents (id, organization_id, name, system_prompt, priority)
     values ($1,$2,$3,'system',$4) on conflict (id) do nothing`,
    [agente, ORG, nome, prioridade],
  );
  await pool.query(
    `insert into ai_agent_versions
       (id, organization_id, agent_id, version_number, system_prompt, provider, model,
        channel_session_id, status, trigger_config)
     values ($1,$2,$3,1,$4,'anthropic','claude-sonnet-4-6',$5,'published',$6::jsonb)
     on conflict (id) do nothing`,
    [versao, ORG, agente, `Você é ${nome}. ${marca}.`, SESSION, JSON.stringify({ filters: { keyword_regex: filtro } })],
  );
  await pool.query(`update ai_agents set published_version_id = $1 where id = $2`, [versao, agente]);
}

beforeAll(async () => {
  m = {
    createInboundTurnHandler: (await import("@/lib/agent-engine/agent/inbound-turn")).createInboundTurnHandler,
    queue: await import("@/lib/agent-engine/queue/queue"),
    createLogger: (await import("@/lib/agent-engine/obs/logger")).createLogger,
    createFakeRegistry: (await import("@/lib/agent-engine/edge/llm/providers")).createFakeRegistry,
  };

  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1,'filtro-assunto','Filtro Assunto','Filtro Assunto') on conflict (id) do nothing`,
    [ORG],
  );
  await pool.query(
    `insert into channel_sessions (id, organization_id, waha_session_name, status, webhook_secret_encrypted)
     values ($1,$2,'filtro-assunto-session','WORKING','\\x00'::bytea) on conflict (id) do nothing`,
    [SESSION, ORG],
  );
  await publica(VENDAS, VENDAS_V, "Vendas", 10, "MARCA-VENDAS", "preço|orçamento");
  await publica(SUPORTE, SUPORTE_V, "Suporte", 1, "MARCA-SUPORTE", "pedido|entrega");

  await semeia(PEDIDO, 1, [
    { direcao: "inbound", texto: "oi", minutosAtras: 2 },
    { direcao: "inbound", texto: "queria saber do meu PEDIDO", minutosAtras: 1 },
  ]);
  await semeia(EM_ANDAMENTO, 2, [
    { direcao: "inbound", texto: "cadê minha entrega?", minutosAtras: 30 },
    { direcao: "outbound", texto: "Sai amanhã! Quer agendar?", minutosAtras: 20 },
    { direcao: "inbound", texto: "pode ser terça?", minutosAtras: 1 },
  ]);
  await pool.query(
    `update conversations set active_ai_agent_id = $3,
       last_outbound_at = $4::timestamptz - interval '20 minutes'
     where organization_id = $1 and id = $2`,
    [ORG, EM_ANDAMENTO.conversa, SUPORTE, AGORA.toISOString()],
  );
  await semeia(BOM_DIA, 3, [{ direcao: "inbound", texto: "bom dia", minutosAtras: 1 }]);

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

describe("filtro de assunto com dois agentes no mesmo número", () => {
  it("a rajada fala de pedido: responde Suporte, mesmo com Vendas mais prioritário", async () => {
    const enviados: string[] = [];
    const { doGenerate } = modeloQueSeIdentifica();

    const erro = await rodaTurno(PEDIDO, montaHandler(doGenerate, enviados));

    expect(erro).toBeNull();
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toMatch(/^\[suporte\]/);
    expect(await agenteDaConversa(PEDIDO)).toBe(SUPORTE);
  });

  it("conversa em andamento com Suporte segue com ele, mesmo fora do assunto", async () => {
    const enviados: string[] = [];
    const { doGenerate } = modeloQueSeIdentifica();

    const erro = await rodaTurno(EM_ANDAMENTO, montaHandler(doGenerate, enviados));

    expect(erro).toBeNull();
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toMatch(/^\[suporte\]/);
  });

  it("ninguém aceita o assunto: ninguém responde, e o modelo nem é chamado", async () => {
    const enviados: string[] = [];
    const { doGenerate, estado } = modeloQueSeIdentifica();

    const erro = await rodaTurno(BOM_DIA, montaHandler(doGenerate, enviados));

    expect(erro).toBeNull();
    expect(enviados).toHaveLength(0);
    expect(estado.chamadas).toBe(0);
    expect(await agenteDaConversa(BOM_DIA)).toBeNull();
  });
});
