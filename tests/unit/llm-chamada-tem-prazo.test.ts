/**
 * TODA CHAMADA DE MODELO TEM PRAZO.
 *
 * Medido em produção (2026-10-06): o `checkpoint` de um turno nunca voltou do
 * provedor. Sem prazo, o job ficou `running` até o visibility timeout reabri-lo,
 * 5 vezes, ~52 min — e a fila serial do contato segurou a mensagem seguinte do
 * cliente por 65 minutos. Nada ficava em `llm_calls`, porque a chamada nunca
 * terminava nem falhava.
 *
 * O que se prova: a chamada pendurada volta como `LlmTempoEsgotadoError` dentro
 * do teto, deixa linha de erro com `error_code='tempo_esgotado'`, e o teto
 * depende do `purpose` (classificador curto, resumo médio, turno longo).
 */
import { describe, expect, it, vi } from "vitest";

import {
  LlmTempoEsgotadoError,
  TEMPO_MAXIMO_PADRAO_MS,
  normalizarErro,
  runModelCall,
  tempoMaximoDaChamadaMs,
} from "@/lib/agent-engine/edge/llm/run-model-call";
import { llmEdgeConfigFromEnv } from "@/lib/agent-engine/edge/llm/credentials";

const ORG = "22222222-2222-4222-8222-222222222222";

function poolQueGrava() {
  const inserts: Array<{ sql: string; params: unknown[] }> = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("settings->'llm'")) {
      return {
        rows: [
          {
            llm: { provider: "anthropic", default_model: "claude-padrao", params: {}, enabled_models: [], monthly_budget_cents: null },
          },
        ],
      };
    }
    if (sql.includes("insert into llm_calls")) {
      inserts.push({ sql, params });
      return { rows: [{ id: "call-1" }] };
    }
    return { rows: [] };
  });
  return { pool: { query } as never, inserts };
}

/** Modelo que NUNCA responde — só cede quando o sinal de aborto dispara. */
function registryPendurado() {
  const fabrica = () =>
    ({
      specificationVersion: "v3",
      provider: "anthropic",
      modelId: "claude-padrao",
      doGenerate: (opts: { abortSignal?: AbortSignal }) =>
        new Promise((_, reject) => {
          opts.abortSignal?.addEventListener("abort", () => reject(opts.abortSignal?.reason ?? new Error("abort")));
        }),
    }) as never;
  return { anthropic: fabrica, openai: fabrica, google: fabrica, openrouter: fabrica };
}

describe("prazo da chamada de modelo", () => {
  it("⭐ chamada pendurada volta como tempo esgotado, dentro do teto, e deixa linha de erro", async () => {
    const { pool, inserts } = poolQueGrava();
    const cfg = { anthropicApiKey: "k-teste", cacheTtl: "1h" as const, tempoMaximoMs: { resumo: 150 } };
    const inicio = Date.now();
    const p = runModelCall(
      pool,
      cfg,
      { tenantId: ORG, purpose: "checkpoint", messages: [{ role: "user", content: "oi" }] },
      { registry: registryPendurado() },
    );
    await expect(p).rejects.toBeInstanceOf(LlmTempoEsgotadoError);
    expect(Date.now() - inicio).toBeLessThan(5_000);

    const erro = inserts.find((i) => i.sql.includes("insert into llm_calls"));
    expect(erro, "a falha por prazo tem de deixar rastro em llm_calls").toBeDefined();
    expect(JSON.stringify(erro?.params)).toContain("tempo_esgotado");
  });

  it("o código é próprio, não se confunde com provedor fora do ar", () => {
    const e = new LlmTempoEsgotadoError("checkpoint", 90_000);
    expect(normalizarErro(e).error_code).toBe("tempo_esgotado");
  });

  it("o teto depende do purpose", () => {
    const cfg = {};
    expect(tempoMaximoDaChamadaMs("stage_classifier", cfg)).toBe(TEMPO_MAXIMO_PADRAO_MS.classificador);
    expect(tempoMaximoDaChamadaMs("promise_semantic", cfg)).toBe(TEMPO_MAXIMO_PADRAO_MS.classificador);
    expect(tempoMaximoDaChamadaMs("jailbreak_detect", cfg)).toBe(TEMPO_MAXIMO_PADRAO_MS.classificador);
    expect(tempoMaximoDaChamadaMs("checkpoint", cfg)).toBe(TEMPO_MAXIMO_PADRAO_MS.resumo);
    expect(tempoMaximoDaChamadaMs("compaction", cfg)).toBe(TEMPO_MAXIMO_PADRAO_MS.resumo);
    expect(tempoMaximoDaChamadaMs("agent_turn", cfg)).toBe(TEMPO_MAXIMO_PADRAO_MS.padrao);
    // purpose desconhecido cai no teto LONGO: nunca corta uma chamada legítima nova.
    expect(tempoMaximoDaChamadaMs("algo_novo", cfg)).toBe(TEMPO_MAXIMO_PADRAO_MS.padrao);
  });

  it("os knobs de env sobrescrevem o default; ausentes, não mexem em nada", () => {
    const comKnobs = llmEdgeConfigFromEnv({ LLM_TIMEOUT_MS: "60000", LLM_TIMEOUT_CLASSIFICADOR_MS: 5000 });
    expect(tempoMaximoDaChamadaMs("agent_turn", comKnobs)).toBe(60_000);
    expect(tempoMaximoDaChamadaMs("stage_classifier", comKnobs)).toBe(5_000);
    expect(tempoMaximoDaChamadaMs("checkpoint", comKnobs)).toBe(TEMPO_MAXIMO_PADRAO_MS.resumo);
    expect(llmEdgeConfigFromEnv({}).tempoMaximoMs).toBeUndefined();
    expect(() => llmEdgeConfigFromEnv({ LLM_TIMEOUT_MS: "10" })).toThrow(/LLM_TIMEOUT_MS/);
  });
});
