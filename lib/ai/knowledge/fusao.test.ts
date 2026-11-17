import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ env: { RERANK_MODEL: "", RERANK_DESLIGADO: "", OPENROUTER_API_KEY: "", OPENROUTER_BASE_URL: "" } }));

import { buscarPorMapa, type ExecutorDeBusca, type LinhaHibrida } from "./buscar-por-mapa";
import { candidatosPorLista, cortar, fundirPorRrf, PISO_DO_RERANK, termosDaBusca } from "./fusao";

describe("termosDaBusca", () => {
  it("normaliza acento e caixa, tira palavra vazia e só deixa [a-z0-9]", () => {
    expect(termosDaBusca("Vocês têm o Tênis AZUL?")).toEqual(["tenis", "azul"]);
  });

  it("código com hífen vira as partes E o código colado", () => {
    const t = termosDaBusca("tem o AB-1234 em estoque?");
    expect(t).toEqual(expect.arrayContaining(["ab1234", "ab", "1234", "estoque"]));
  });

  it("preço com vírgula vira o número colado", () => {
    expect(termosDaBusca("o de 49,90")).toEqual(expect.arrayContaining(["4990", "49", "90"]));
  });

  it("nenhum operador de tsquery sobrevive", () => {
    for (const t of termosDaBusca("a & b | !c <-> d:* (e) 'f'")) expect(t).toMatch(/^[a-z0-9]{2,40}$/);
  });
});

describe("fundirPorRrf", () => {
  it("quem aparece bem nas duas listas vence quem só aparece numa", () => {
    const f = fundirPorRrf([
      { chunk_id: "so-vetor", rank_vetor: 1, rank_texto: null },
      { chunk_id: "nas-duas", rank_vetor: 2, rank_texto: 1 },
      { chunk_id: "so-texto", rank_vetor: null, rank_texto: 2 },
    ]);
    expect(f.map((x) => x.chunk_id)).toEqual(["nas-duas", "so-vetor", "so-texto"]);
  });

  it("o mesmo trecho vindo de dois mapas fica com a melhor posição de cada lista", () => {
    const f = fundirPorRrf([
      { chunk_id: "x", rank_vetor: 5, rank_texto: null },
      { chunk_id: "x", rank_vetor: 1, rank_texto: 3 },
    ]);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ rank_vetor: 1, rank_texto: 3 });
  });
});

describe("cortar", () => {
  const linha = (id: string, similarity: number, rank_texto: number | null, relevancia: number | null) => ({
    chunk_id: id,
    similarity,
    rank_texto,
    relevancia,
  });

  it("com rerank: só o que passa do piso de relevância, até topK", () => {
    const r = cortar([linha("a", 0.1, null, 0.9), linha("b", 0.9, null, PISO_DO_RERANK - 0.01), linha("c", 0.2, 1, 0.5)], {
      topK: 5,
      limiar: 0.4,
      reordenado: true,
    });
    expect(r.map((x) => x.chunk_id)).toEqual(["a", "c"]);
  });

  it("sem rerank: vetor acima do limiar OU texto no topo", () => {
    const r = cortar([linha("a", 0.8, null, null), linha("b", 0.1, 1, null), linha("c", 0.1, 9, null), linha("d", 0.3, null, null)], {
      topK: 3,
      limiar: 0.4,
      reordenado: false,
    });
    expect(r.map((x) => x.chunk_id)).toEqual(["a", "b"]);
  });

  it("candidatos por lista acompanham o topK, com piso e teto", () => {
    expect(candidatosPorLista(1)).toBe(20);
    expect(candidatosPorLista(10)).toBe(40);
    expect(candidatosPorLista(50)).toBe(60);
  });
});

describe("buscarPorMapa — caminho híbrido", () => {
  type L = { chunk_id: string; content: string; similarity: number };
  const linha = (id: string, sim: number, rv: number | null, rt: number | null): LinhaHibrida<L> => ({
    chunk_id: id,
    content: `trecho ${id}`,
    similarity: sim,
    rank_vetor: rv,
    rank_texto: rt,
  });

  function executor(linhas: Array<LinhaHibrida<L>>, chamadas: unknown[][]): ExecutorDeBusca<L> {
    return {
      mapasDasFontes: async (fontes) => new Map(fontes.map((f) => [f, "mapa-1"])),
      buscar: async () => {
        throw new Error("o caminho antigo não devia ser chamado");
      },
      buscarHibrido: async (...args) => {
        chamadas.push(args);
        return linhas;
      },
    };
  }

  const deps = {
    embed: async () => ({ embedding: [0.1], promptTokens: 1, model: "m" }),
    chaveDoMapa: async () => ({}) as never,
  };

  it("o SKU que só o texto acha chega ao agente quando o rerank aprova", async () => {
    const chamadas: unknown[][] = [];
    const r = await buscarPorMapa({
      organizationId: "org",
      fontes: ["f1"],
      query: "tem o AB-1234?",
      k: 2,
      limiar: 0.4,
      executor: executor([linha("parecido", 0.6, 1, null), linha("sku", 0.2, null, 1), linha("ruido", 0.5, 2, null)], chamadas),
      deps: {
        ...deps,
        rerank: {
          resolverChave: async () => ({ apiKey: "k", origem: "chave_openrouter_da_instalacao" }),
          registrar: () => {},
          fetchImpl: (async () =>
            new Response(
              JSON.stringify({
                results: [
                  { index: 1, relevance_score: 0.95 },
                  { index: 0, relevance_score: 0.4 },
                  { index: 2, relevance_score: 0.05 },
                ],
              }),
            )) as unknown as typeof fetch,
        },
      },
    });
    expect(r.cortado).toBe(true);
    expect(r.diagnostico?.reordenado).toBe(true);
    expect(r.hits.map((h) => h.chunk_id)).toEqual(["sku", "parecido"]);
    // Os termos chegam ao banco já sanitizados.
    expect(chamadas[0]?.[2]).toEqual(expect.arrayContaining(["ab1234"]));
    // O top_score é do melhor candidato, não do corte.
    expect(r.melhorSimilaridade).toBe(0.6);
  });

  it("sem chave de rerank, o texto no topo ainda entra e o vetor respeita o limiar", async () => {
    const r = await buscarPorMapa({
      organizationId: "org",
      fontes: ["f1"],
      query: "AB-1234",
      k: 3,
      limiar: 0.55,
      executor: executor([linha("parecido", 0.6, 1, null), linha("sku", 0.2, null, 1), linha("fraco", 0.5, 2, null)], []),
      deps: { ...deps, rerank: { resolverChave: async () => null, registrar: () => {} } },
    });
    expect(r.diagnostico?.reordenado).toBe(false);
    expect(r.hits.map((h) => h.chunk_id).sort()).toEqual(["parecido", "sku"]);
  });
});
