import { beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import type * as Ensaiar from "@/lib/agent-engine/ensaio/ensaiar";
import type * as Providers from "@/lib/agent-engine/edge/llm/providers";
import type * as ObsLogger from "@/lib/agent-engine/obs/logger";
import type * as Validation from "@/lib/ai/agents/validation";

/**
 * O LIMITE POR ATENDIMENTO CORTA O AGENTE EM LAÇO — E O CLIENTE É RESPONDIDO.
 *
 * Pelo turno de produção inteiro (via ensaio: o mesmo handler do worker, numa
 * transação desfeita), com um modelo que chama ferramenta para sempre, a 610
 * tokens novos por passo, e `token_budget` de 1.000:
 *
 *  - o laço para no 2º passo (antes: ia até o teto de passos, gastando);
 *  - nada tinha sido enviado, então o resgate do turno mudo dá UMA chamada
 *    obrigatória e o cliente recebe resposta — o limite nunca vira silêncio;
 *  - a Central recebe o aviso do limite, que diz onde mexer.
 *
 * Sabotagens descritas (o Postgres de teste só sobe no CI): tirar o
 * `pararQuando` da chamada principal em `inbound-turn.ts` → mais de 2
 * ferramentas executadas e nenhum aviso; tirar `avisarLimiteDoTurno` → sem aviso.
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

const ORG = "e6e6e6e6-0000-4000-8000-000000000001";
const SESSION = "e6e6e6e6-0000-4000-8000-000000000002";
/** Terça, 15h BRT — dentro da janela anti-ban. */
const AGORA = new Date("2026-07-28T18:00:00Z");

type Modules = {
  ensaiarTurno: typeof Ensaiar.ensaiarTurno;
  createLogger: typeof ObsLogger.createLogger;
  createFakeRegistry: typeof Providers.createFakeRegistry;
  versionCreateSchema: typeof Validation.versionCreateSchema;
};
let m: Modules;

const CHECKPOINT = JSON.stringify({
  commitments: [],
  objections: [],
  next_action: null,
  rolling_summary: "ensaio do limite",
});

const USO_DO_PASSO = {
  inputTokens: { total: 600, noCache: 600, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 },
};

interface OpcoesDaChamada {
  tools?: Array<{ name: string }>;
  toolChoice?: { type: string };
}

/**
 * O modelo em laço. Lê as opções da chamada para saber em que ponto do turno
 * está: sem ferramentas é o checkpoint; com escolha obrigatória é o resgate.
 */
function modeloEmLaco() {
  let n = 0;
  return async (opcoes: OpcoesDaChamada) => {
    n += 1;
    const nomes = (opcoes.tools ?? []).map((t) => t.name);
    if (nomes.length === 0) {
      return { content: [{ type: "text" as const, text: CHECKPOINT }], finishReason: { unified: "stop" as const, raw: undefined }, usage: USO_DO_PASSO, warnings: [] };
    }
    const resgate = opcoes.toolChoice?.type === "required";
    return {
      content: [
        {
          type: "tool-call" as const,
          toolCallId: `c${n}`,
          toolName: resgate ? "send_message" : "crm_list_pipelines",
          input: JSON.stringify(resgate ? { body: "Temos sim! Já te passo os detalhes." } : {}),
        },
      ],
      finishReason: { unified: "tool-calls" as const, raw: undefined },
      usage: USO_DO_PASSO,
      warnings: [],
    };
  };
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
  } as never;
}

beforeAll(async () => {
  m = {
    ensaiarTurno: (await import("@/lib/agent-engine/ensaio/ensaiar")).ensaiarTurno,
    createLogger: (await import("@/lib/agent-engine/obs/logger")).createLogger,
    createFakeRegistry: (await import("@/lib/agent-engine/edge/llm/providers")).createFakeRegistry,
    versionCreateSchema: (await import("@/lib/ai/agents/validation")).versionCreateSchema,
  };
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1,'limite-turno','Limite Turno','Limite Turno') on conflict (id) do nothing`,
    [ORG],
  );
  await pool.query(
    `insert into channel_sessions (id, organization_id, waha_session_name, status, webhook_secret_encrypted)
     values ($1,$2,'limite-turno-session','WORKING','\\x00'::bytea) on conflict (id) do nothing`,
    [SESSION, ORG],
  );
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

describe("limite por atendimento", () => {
  it("corta o laço, o cliente é respondido pelo resgate, e a Central fica sabendo", async () => {
    const r = await m.ensaiarTurno(pool, deps(modeloEmLaco()), {
      organizationId: ORG,
      agentId: null,
      versao: m.versionCreateSchema.parse({
        system_prompt: "Você atende a loja de teste. Responda curto.",
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        credential_id: null,
        channel_session_id: SESSION,
        tool_ids: ["crm_list_pipelines"],
        max_steps: 12,
        token_budget: 1000,
      }),
      conversa: [{ de: "cliente", texto: "Vocês têm o plano anual?" }],
      agora: AGORA,
    });

    expect(r.erro).toBeNull();
    // 610 tokens no 1º passo, 1.220 no 2º: o laço para ali.
    expect(r.ferramentas.filter((f) => f.ferramenta === "crm_list_pipelines")).toHaveLength(2);
    expect(r.desfecho).toBe("respondeu");
    expect(r.mensagens.map((x) => x.texto)).toEqual(["Temos sim! Já te passo os detalhes."]);
    expect(r.avisos.map((a) => a.titulo)).toContainEqual(expect.stringMatching(/limite por atendimento cortou/));
  });
});
