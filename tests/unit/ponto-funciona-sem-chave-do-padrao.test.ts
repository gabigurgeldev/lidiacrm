/**
 * O PONTO VALE MESMO QUANDO O PADRÃO DA ORGANIZAÇÃO NÃO TEM CHAVE.
 *
 * Medido em produção (2026-10-10): organização só com chave OpenRouter, padrão
 * declarado `anthropic` (o default de quem nunca mexeu), e o ponto
 * `coordenador_decidir` configurado em IA › Provedores para a OpenRouter. Toda
 * decisão do coordenador falhava com "org sem credencial LLM utilizável" — o
 * `runModelCall` resolvia a chave do PADRÃO antes de olhar o ponto, e morria ali.
 * Na tela, o coordenador dizia "o modelo de decisão falhou" e mandava toda
 * conversa para o destino padrão.
 *
 * A prova é o argumento que chega à fábrica do registry, como em
 * `seam-respeita-o-binding.test.ts`.
 */
import { describe, expect, it, vi } from "vitest";

import { LlmNotConfiguredError, runModelCall } from "@/lib/agent-engine/edge/llm/run-model-call";

const ORG = "11111111-1111-4111-8111-111111111111";

function poolFalso(binding: { provider: string; model_id: string } | null) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("settings->'llm'")) {
      // O padrão de quem nunca configurou: anthropic, sem modelo.
      return { rows: [{ llm: {} }] };
    }
    if (sql.includes("from ai_purpose_bindings")) {
      return {
        rows: binding ? [{ ...binding, credential_id: null, base_url: null, is_enabled: true }] : [],
      };
    }
    if (sql.includes("from ai_provider_credentials")) return { rows: [] };
    if (sql.includes("insert into llm_calls")) return { rows: [{ id: "call-1" }] };
    return { rows: [] };
  });
  return { query } as never;
}

function registrySpiao() {
  const chamadas: Array<{ provider: string; apiKey: string; modelId: string }> = [];
  const fabrica = (provider: string) => (apiKey: string, modelId: string) => {
    chamadas.push({ provider, apiKey, modelId });
    return {
      specificationVersion: "v3",
      provider,
      modelId,
      doGenerate: async () => ({
        content: [{ type: "text", text: '{"escolha":"faby_ai","confianca":0.9}' }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      }),
    } as never;
  };
  return {
    chamadas,
    registry: { anthropic: fabrica("anthropic"), openai: fabrica("openai"), openrouter: fabrica("openrouter") },
  };
}

// Só a chave da OpenRouter existe — nada de Anthropic, que é o padrão declarado.
const cfg = { openrouterApiKey: "chave-openrouter", cacheTtl: "1h" as const };

const chamar = (pool: never, registry: never, extra: Record<string, unknown> = {}) =>
  runModelCall(
    pool,
    cfg,
    { tenantId: ORG, purpose: "coordenador_decidir", messages: [{ role: "user", content: "oi" }], ...extra },
    { registry },
  );

describe("ponto configurado funciona sem chave do provedor padrão", () => {
  it("o ponto aponta para a OpenRouter: a chamada sai pela OpenRouter", async () => {
    const { registry, chamadas } = registrySpiao();
    const r = await chamar(poolFalso({ provider: "openrouter", model_id: "anthropic/claude-haiku-5.5" }), registry as never);
    expect(chamadas).toEqual([
      { provider: "openrouter", apiKey: "chave-openrouter", modelId: "anthropic/claude-haiku-5.5" },
    ]);
    expect(r.result.text).toContain("faby_ai");
  });

  it("sem ponto configurado, o erro de sempre: não há chave para o padrão", async () => {
    const { registry, chamadas } = registrySpiao();
    await expect(chamar(poolFalso(null), registry as never)).rejects.toBeInstanceOf(LlmNotConfiguredError);
    expect(chamadas).toHaveLength(0);
  });

  it("com o provedor escolhido pelo agente, a falta de chave dele sobe — o ponto não o contorna", async () => {
    const { registry, chamadas } = registrySpiao();
    await expect(
      chamar(poolFalso({ provider: "openrouter", model_id: "x/y" }), registry as never, {
        llmOverride: { provider: "anthropic", credentialId: null },
        model: "claude-x",
      }),
    ).rejects.toBeInstanceOf(LlmNotConfiguredError);
    expect(chamadas).toHaveLength(0);
  });
});
