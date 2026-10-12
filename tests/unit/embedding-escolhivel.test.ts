/**
 * O MODELO DO MATERIAL É ESCOLHÍVEL — E O MAPA CONTINUA AMARRADO.
 *
 * "Buscar no seu material" era fixo em text-embedding-3-small. Agora o painel
 * escolhe provedor e modelo; o que estes testes travam é que a liberdade não
 * quebra a busca:
 *  - todo modelo do catálogo entrega 1536 dimensões (nativo ou pelo corte);
 *  - o mapa não depende de quem carrega a chamada (OpenAI ou OpenRouter servem
 *    o mesmo text-embedding-3-small — ninguém reindexa por trocar de chave);
 *  - o mapa legado é exatamente o que as versões antigas gravaram;
 *  - a busca embeda a pergunta no mapa de CADA material e funde.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ env: {} }));

import {
  CATALOGO_DE_EMBEDDING,
  DIMENSOES,
  MAPA_LEGADO,
  modeloDoBinding,
  modeloDoCatalogo,
  modeloDoMapa,
  provedoresDoMapa,
} from "@/lib/ai/embeddings/catalogo";
import { agruparPorMapa, buscarPorMapa, fundirResultados } from "@/lib/ai/knowledge/buscar-por-mapa";
import { motivoDaFalha, provarModeloDeEmbedding } from "@/lib/ai/embeddings/prova";
import type { ChaveDeEmbedding } from "@/lib/ai/embeddings/chave";

describe("catálogo de embedding", () => {
  it("o mapa legado é o valor que as versões antigas gravaram", () => {
    expect(MAPA_LEGADO).toBe("openai/text-embedding-3-small");
    expect(DIMENSOES).toBe(1536);
  });

  it("todo modelo chega a 1536: nativo, ou com parâmetro de corte e @1536 no mapa", () => {
    for (const m of CATALOGO_DE_EMBEDDING) {
      for (const p of Object.values(m.provedores)) {
        if (m.dimsNativas === DIMENSOES) expect(p!.parametro, m.mapa).toBeNull();
        else {
          expect(p!.parametro, m.mapa).not.toBeNull();
          expect(m.mapa.endsWith("@1536"), m.mapa).toBe(true);
        }
      }
    }
  });

  it("o mesmo modelo por OpenAI e por OpenRouter é o MESMO mapa", () => {
    expect(modeloDoCatalogo("openai", "text-embedding-3-small")?.mapa).toBe(MAPA_LEGADO);
    expect(modeloDoCatalogo("openrouter", "openai/text-embedding-3-small")?.mapa).toBe(MAPA_LEGADO);
    expect(provedoresDoMapa("google/gemini-embedding-001@1536")).toEqual(["openrouter", "google"]);
  });

  it("binding sem modelo de embedding (formato antigo) não escolhe modelo", () => {
    expect(modeloDoBinding({ provider: "openai", model_id: "gpt-5-mini" })).toBeNull();
    expect(modeloDoBinding({ provider: "anthropic", model_id: "x-embed" })).toBeNull();
    expect(modeloDoBinding(null)).toBeNull();
  });

  it("id próprio com 'embed' vira mapa @1536 com parâmetro de corte", () => {
    expect(modeloDoBinding({ provider: "openrouter", model_id: "qwen/qwen3-embedding-8b" })).toEqual({
      mapa: "qwen/qwen3-embedding-8b@1536",
      provedor: "openrouter",
      idNoProvedor: "qwen/qwen3-embedding-8b",
      parametro: "dimensions",
      doCatalogo: false,
    });
  });

  it("um provedor que não serve o mapa devolve null", () => {
    expect(modeloDoMapa("google/gemini-embedding-001@1536", "openai")).toBeNull();
  });
});

describe("busca por mapa", () => {
  it("agrupa pelo mapa da versão ativa e ignora material sem versão", () => {
    const grupos = agruparPorMapa(
      ["a", "b", "c", "d"],
      new Map([
        ["a", MAPA_LEGADO],
        ["b", "google/gemini-embedding-001@1536"],
        ["c", MAPA_LEGADO],
      ]),
    );
    expect([...grupos.entries()]).toEqual([
      [MAPA_LEGADO, ["a", "c"]],
      ["google/gemini-embedding-001@1536", ["b"]],
    ]);
  });

  it("funde por similaridade e corta em K; NaN vai ao fim", () => {
    const r = fundirResultados([[{ similarity: 0.5 }, { similarity: Number.NaN }], [{ similarity: 0.9 }]], 2);
    expect(r.map((x) => x.similarity)).toEqual([0.9, 0.5]);
  });

  it("durante a troca de modelo, embeda UMA vez por mapa, com a chave de cada mapa, e acha os dois", async () => {
    const chaveDoMapa = vi.fn(async (_org: string, mapa: string) => ({ modelo: { mapa } }) as unknown as ChaveDeEmbedding);
    const embed = vi.fn(async (_q: string, o: { chave?: ChaveDeEmbedding }) => ({
      embedding: [o.chave!.modelo.mapa === MAPA_LEGADO ? 1 : 2],
      promptTokens: 1,
      model: o.chave!.modelo.mapa,
    }));
    const buscar = vi.fn(async (fontes: readonly string[], vetor: string, _k: number, mapa: string) =>
      fontes.map((f) => ({ fonte: f, vetor, mapa, similarity: f === "novo" ? 0.8 : 0.7 })),
    );
    const { hits } = await buscarPorMapa({
      organizationId: "org",
      fontes: ["velho", "novo"],
      query: "frete",
      k: 5,
      executor: {
        mapasDasFontes: async () =>
          new Map([
            ["velho", MAPA_LEGADO],
            ["novo", "openai/text-embedding-3-large@1536"],
          ]),
        buscar,
      },
      deps: { embed: embed as never, chaveDoMapa },
    });
    expect(embed).toHaveBeenCalledTimes(2);
    expect(hits.map((h) => [h.fonte, h.vetor, h.mapa])).toEqual([
      ["novo", "[2]", "openai/text-embedding-3-large@1536"],
      ["velho", "[1]", MAPA_LEGADO],
    ]);
  });

  it("estado normal (um mapa só) embeda uma vez — custo igual ao de antes", async () => {
    const embed = vi.fn(async () => ({ embedding: [1], promptTokens: 1, model: MAPA_LEGADO }));
    await buscarPorMapa({
      organizationId: "org",
      fontes: ["a", "b"],
      query: "q",
      k: 3,
      executor: {
        mapasDasFontes: async () => new Map([["a", MAPA_LEGADO], ["b", MAPA_LEGADO]]),
        buscar: async () => [],
      },
      deps: { embed: embed as never, chaveDoMapa: async () => ({ modelo: { mapa: MAPA_LEGADO } }) as never },
    });
    expect(embed).toHaveBeenCalledTimes(1);
  });

  it("sem chave para NENHUM mapa é o erro tipado de sempre", async () => {
    await expect(
      buscarPorMapa({
        organizationId: "org",
        fontes: ["a"],
        query: "q",
        k: 3,
        executor: { mapasDasFontes: async () => new Map([["a", MAPA_LEGADO]]), buscar: async () => [] },
        deps: { embed: vi.fn() as never, chaveDoMapa: async () => null },
      }),
    ).rejects.toMatchObject({ code: "embedding_sem_chave" });
  });
});

describe("prova de salvar", () => {
  const gemini = modeloDoMapa("google/gemini-embedding-001@1536", "openrouter")!;

  it("dimensão errada vira mensagem que diz o que fazer", () => {
    expect(motivoDaFalha(new Error("embedding com 3072 dimensões, esperado 1536"), gemini)).toMatchObject({
      codigo: "embedding_dimensao_incompativel",
      status: 422,
    });
  });

  it("401 vira chave recusada; rede vira 502 sem gravar nada", () => {
    expect(motivoDaFalha(Object.assign(new Error("Unauthorized"), { statusCode: 401 }), gemini).codigo).toBe(
      "embedding_chave_recusada",
    );
    expect(motivoDaFalha(new Error("ECONNRESET"), gemini)).toMatchObject({ codigo: "embedding_provedor_indisponivel", status: 502 });
  });

  it("sem chave do provedor escolhido, recusa antes de chamar", async () => {
    const embed = vi.fn();
    const r = await provarModeloDeEmbedding("org", gemini, null, { embed: embed as never, chave: async () => null });
    expect(r).toMatchObject({ ok: false, codigo: "embedding_sem_chave" });
    expect(embed).not.toHaveBeenCalled();
  });

  it("chamada com 1536 passa", async () => {
    const r = await provarModeloDeEmbedding("org", gemini, null, {
      embed: (async () => ({ embedding: [], promptTokens: 1, model: gemini.mapa })) as never,
      chave: async () => ({ modelo: gemini }) as never,
    });
    expect(r).toEqual({ ok: true });
  });
});
