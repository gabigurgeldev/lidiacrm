import { beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import type * as Ensaiar from "@/lib/agent-engine/ensaio/ensaiar";
import type * as Providers from "@/lib/agent-engine/edge/llm/providers";
import type * as ObsLogger from "@/lib/agent-engine/obs/logger";
import type * as Validation from "@/lib/ai/agents/validation";

/**
 * O ENSAIO DO AGENTE RODA O TURNO DE PRODUÇÃO — E NÃO DEIXA NADA PARA TRÁS.
 *
 * O botão Testar antigo rodava outro motor, e as capacidades de escrita mexiam
 * no CRM real. O ensaio (`lib/agent-engine/ensaio/ensaiar.ts`) roda o MESMO
 * handler do worker dentro de uma transação desfeita no fim. Este arquivo
 * guarda as três promessas que a tela vai fazer ao dono do negócio:
 *
 *  1. "nada é enviado nem gravado": a contagem de TODA tabela de `public` é a
 *     mesma antes e depois — menos `llm_calls` e `ai_budgets`, que são o custo
 *     real da IA (a outra promessa: "o custo é real") e vão por outra conexão;
 *  2. o atendimento de verdade não espera pelo teste: durante o ensaio, a trava
 *     do número REAL está livre para outra conexão;
 *  3. o relatório traz o que o agente teria mandado e o que ele tentou fazer.
 *
 * Sabotagens que este arquivo pega (descritas, não medidas localmente — o
 * Postgres de teste só sobe no CI):
 *  - a fachada deixar `commit` passar como commit: a contagem muda;
 *  - a chave da trava não ganhar o prefixo do ensaio: a sonda da trava falha;
 *  - a contabilidade ir pela transação: `llm_calls` não ganha linha.
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
  max: 4,
});

const ORG = "e5e5e5e5-0000-4000-8000-000000000001";
const SESSION = "e5e5e5e5-0000-4000-8000-000000000002";
/** Terça, 15h BRT — dentro da janela anti-ban. */
const AGORA = new Date("2026-07-28T18:00:00Z");

/** Tabelas que o ensaio ESCREVE de propósito, fora da transação: o custo real da IA. */
const CUSTO_REAL = new Set(["llm_calls", "ai_budgets"]);

type Modules = {
  ensaiarTurno: typeof Ensaiar.ensaiarTurno;
  EnsaioOcupadoError: typeof Ensaiar.EnsaioOcupadoError;
  createLogger: typeof ObsLogger.createLogger;
  createFakeRegistry: typeof Providers.createFakeRegistry;
  versionCreateSchema: typeof Validation.versionCreateSchema;
};
let m: Modules;

const USO = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

const CHECKPOINT = JSON.stringify({
  commitments: [],
  objections: [],
  next_action: null,
  rolling_summary: "ensaio de teste",
});

function chamada(n: number, toolName: string, input: unknown) {
  return {
    content: [{ type: "tool-call" as const, toolCallId: `c${n}`, toolName, input: JSON.stringify(input) }],
    finishReason: { unified: "tool-calls" as const, raw: undefined },
    usage: USO,
    warnings: [],
  };
}

function texto(t: string) {
  return {
    content: [{ type: "text" as const, text: t }],
    finishReason: { unified: "stop" as const, raw: undefined },
    usage: USO,
    warnings: [],
  };
}

/**
 * Roteiro: consulta uma capacidade do CRM, responde, encerra, checkpoint. A
 * partir da 3ª chamada — o envio já passou pela cadeia e a trava do número foi
 * tomada —, uma OUTRA conexão tenta a trava do número real.
 */
function modelo(sondas: boolean[]) {
  let n = 0;
  const doGenerate = async () => {
    n += 1;
    if (n >= 3) sondas.push(await travaDoNumeroLivre());
    if (n === 1) return chamada(n, "crm_list_pipelines", {});
    if (n === 2) return chamada(n, "send_message", { body: "Temos sim! O plano anual sai mais em conta." });
    if (n === 3) return texto("pronto, respondi.");
    return texto(CHECKPOINT);
  };
  return doGenerate;
}

async function travaDoNumeroLivre(): Promise<boolean> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const { rows } = await c.query<{ ok: boolean }>("select pg_try_advisory_xact_lock(hashtext($1)) as ok", [
      SESSION,
    ]);
    await c.query("rollback");
    return rows[0]?.ok === true;
  } finally {
    c.release();
  }
}

async function contagens(): Promise<Record<string, number>> {
  const { rows: tabelas } = await pool.query<{ t: string }>(
    `select table_name as t from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`,
  );
  const r: Record<string, number> = {};
  for (const { t } of tabelas) {
    if (CUSTO_REAL.has(t)) continue;
    const { rows } = await pool.query<{ n: string }>(`select count(*) as n from public."${t}"`);
    r[t] = Number(rows[0]?.n ?? 0);
  }
  return r;
}

function deps(doGenerate: unknown) {
  return {
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
  } as never;
}

function pedido() {
  return {
    organizationId: ORG,
    agentId: null,
    versao: m.versionCreateSchema.parse({
      system_prompt: "Você atende a loja de teste. Responda curto e cordial.",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      credential_id: null,
      channel_session_id: SESSION,
      tool_ids: ["crm_list_pipelines"],
    }),
    conversa: [{ de: "cliente" as const, texto: "Vocês têm o plano anual?" }],
    nomeDoContato: "Cliente do ensaio",
    agora: AGORA,
  };
}

beforeAll(async () => {
  m = {
    ...(await import("@/lib/agent-engine/ensaio/ensaiar")),
    createLogger: (await import("@/lib/agent-engine/obs/logger")).createLogger,
    createFakeRegistry: (await import("@/lib/agent-engine/edge/llm/providers")).createFakeRegistry,
    versionCreateSchema: (await import("@/lib/ai/agents/validation")).versionCreateSchema,
  };

  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1,'ensaio-rastro','Ensaio Rastro','Ensaio Rastro') on conflict (id) do nothing`,
    [ORG],
  );
  await pool.query(
    `insert into channel_sessions (id, organization_id, waha_session_name, status, webhook_secret_encrypted)
     values ($1,$2,'ensaio-rastro-session','WORKING','\\x00'::bytea) on conflict (id) do nothing`,
    [SESSION, ORG],
  );
  // O canal do ensaio lê a saúde REAL do número (o espelho do watchdog).
  await pool.query(
    `insert into channel_session_health (organization_id, channel_session_id, status)
     values ($1, $2, 'WORKING') on conflict (organization_id, channel_session_id) do nothing`,
    [ORG, SESSION],
  );
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

describe("o ensaio do agente", () => {
  it("responde pelo turno de produção, não deixa linha nenhuma, e não segura o número real", async () => {
    const antes = await contagens();
    const { rows: custoAntes } = await pool.query<{ n: string }>(
      `select count(*) as n from llm_calls where organization_id = $1 and purpose like 'ensaio:%'`,
      [ORG],
    );
    const sondas: boolean[] = [];

    const r = await m.ensaiarTurno(pool, deps(modelo(sondas)), pedido());

    // 3. O relatório.
    expect(r.erro).toBeNull();
    expect(r.desfecho).toBe("respondeu");
    expect(r.mensagens.map((x) => x.texto)).toEqual(["Temos sim! O plano anual sai mais em conta."]);
    expect(r.ferramentas).toContainEqual(
      expect.objectContaining({ ferramenta: "crm_list_pipelines", simulada: true }),
    );
    expect(r.conferencias.length).toBeGreaterThan(0);

    // 1. Nada ficou.
    expect(await contagens()).toEqual(antes);

    // ... menos o custo, que é real e foi contado.
    const { rows: custoDepois } = await pool.query<{ n: string; com_contato: string }>(
      `select count(*) as n, count(contact_id) as com_contato from llm_calls
        where organization_id = $1 and purpose like 'ensaio:%'`,
      [ORG],
    );
    expect(r.custo.chamadas).toBeGreaterThan(0);
    expect(Number(custoDepois[0]!.n) - Number(custoAntes[0]!.n)).toBe(r.custo.chamadas);
    expect(Number(custoDepois[0]!.com_contato)).toBe(0);

    // 2. O número real ficou livre o tempo todo.
    expect(sondas.length).toBeGreaterThan(0);
    expect(sondas.every(Boolean)).toBe(true);
  });

  it("um segundo ensaio na mesma organização é recusado, sem esperar", async () => {
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query("select pg_advisory_xact_lock(hashtext($1))", [`ensaio-da-org:${ORG}`]);
      await expect(m.ensaiarTurno(pool, deps(modelo([])), pedido())).rejects.toBeInstanceOf(
        m.EnsaioOcupadoError,
      );
    } finally {
      await c.query("rollback");
      c.release();
    }
  });
});
