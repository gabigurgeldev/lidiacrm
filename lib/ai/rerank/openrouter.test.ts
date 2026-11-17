import { describe, expect, it, vi } from "vitest";

import { lerResposta, reordenar, reordenarItens, type DepsDoRerank } from "./openrouter";

const chave = async () => ({ apiKey: "sk-teste", origem: "chave_openrouter_da_instalacao" as const });
const semRegistro = () => {};

function respostaJson(corpo: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(corpo), { status })) as unknown as typeof fetch;
}

const base = { organizationId: "org-1", query: "qual o prazo de troca?", ponto: "material" as const };

describe("lerResposta", () => {
  it("ordena pela relevância", () => {
    const r = lerResposta(
      { results: [{ index: 0, relevance_score: 0.1 }, { index: 2, relevance_score: 0.9 }] },
      3,
    );
    expect(r?.itens.map((i) => i.indice)).toEqual([2, 0]);
  });

  it("recusa a resposta inteira quando um índice é inválido ou repetido", () => {
    expect(lerResposta({ results: [{ index: 5, relevance_score: 0.5 }] }, 3)).toBeNull();
    expect(
      lerResposta({ results: [{ index: 1, relevance_score: 0.5 }, { index: 1, relevance_score: 0.4 }] }, 3),
    ).toBeNull();
    expect(lerResposta({ results: [{ index: 1, relevance_score: "alto" }] }, 3)).toBeNull();
    expect(lerResposta({ data: [] }, 3)).toBeNull();
  });

  it("lê o custo quando a resposta traz", () => {
    expect(lerResposta({ results: [{ index: 0, relevance_score: 1 }], usage: { cost: 0.0001 } }, 1)?.custoUsd).toBe(0.0001);
  });
});

describe("reordenar", () => {
  it("devolve a ordem do modelo e manda o corpo esperado à OpenRouter", async () => {
    const fetchImpl = vi.fn(respostaJson({ results: [{ index: 1, relevance_score: 0.8 }, { index: 0, relevance_score: 0.2 }] }));
    const r = await reordenar(
      { ...base, documentos: ["a", "b"], topN: 2 },
      { resolverChave: chave, fetchImpl, registrar: semRegistro },
    );
    expect(r).toEqual([
      { indice: 1, relevancia: 0.8 },
      { indice: 0, relevancia: 0.2 },
    ]);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toMatch(/\/rerank$/);
    const corpo = JSON.parse(String((init as RequestInit).body));
    expect(corpo).toMatchObject({ query: base.query, documents: ["a", "b"], top_n: 2 });
    expect((init as RequestInit).headers).toMatchObject({ authorization: "Bearer sk-teste" });
  });

  it("sem chave não chama ninguém e devolve null", async () => {
    const fetchImpl = vi.fn();
    const r = await reordenar(
      { ...base, documentos: ["a", "b"] },
      { resolverChave: async () => null, fetchImpl: fetchImpl as unknown as typeof fetch, registrar: semRegistro },
    );
    expect(r).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("menos de 2 documentos não vale a chamada", async () => {
    const fetchImpl = vi.fn();
    const r = await reordenar(
      { ...base, documentos: ["a"] },
      { resolverChave: chave, fetchImpl: fetchImpl as unknown as typeof fetch, registrar: semRegistro },
    );
    expect(r).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("erro HTTP, rede caída e resposta malformada viram null e são registrados", async () => {
    const linhas: Array<{ erro: string | null }> = [];
    const registrar: DepsDoRerank["registrar"] = (l) => linhas.push(l);
    const docs = { ...base, documentos: ["a", "b"] };

    expect(await reordenar(docs, { resolverChave: chave, registrar, fetchImpl: respostaJson({ error: "x" }, 402) })).toBeNull();
    expect(
      await reordenar(docs, {
        resolverChave: chave,
        registrar,
        fetchImpl: (async () => {
          throw new Error("ECONNRESET");
        }) as unknown as typeof fetch,
      }),
    ).toBeNull();
    expect(await reordenar(docs, { resolverChave: chave, registrar, fetchImpl: respostaJson({ results: "?" }) })).toBeNull();

    expect(linhas.map((l) => l.erro)).toEqual(["http_402", "falha_de_rede", "resposta_invalida"]);
  });

  it("estoura o teto de espera e devolve null em vez de segurar a busca", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = ((_: unknown, init: RequestInit) =>
        new Promise((_res, rej) => {
          init.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
        })) as unknown as typeof fetch;
      const linhas: Array<{ erro: string | null }> = [];
      const p = reordenar({ ...base, documentos: ["a", "b"] }, { resolverChave: chave, fetchImpl, registrar: (l) => linhas.push(l) });
      await vi.advanceTimersByTimeAsync(1_600);
      expect(await p).toBeNull();
      expect(linhas[0]?.erro).toBe("timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  it("chave falhando ao resolver não derruba a busca", async () => {
    const r = await reordenar(
      { ...base, documentos: ["a", "b"] },
      {
        resolverChave: async () => {
          throw new Error("decrypt");
        },
        registrar: semRegistro,
      },
    );
    expect(r).toBeNull();
  });
});

describe("reordenarItens", () => {
  const itens = [{ id: "x", t: "frete" }, { id: "y", t: "troca em 7 dias" }, { id: "z", t: "horário" }];

  it("aplica a ordem e corta em topN", async () => {
    const r = await reordenarItens(
      { ...base, itens, texto: (i) => i.t, topN: 1 },
      { resolverChave: chave, registrar: semRegistro, fetchImpl: respostaJson({ results: [{ index: 1, relevance_score: 0.9 }, { index: 0, relevance_score: 0.1 }] }) },
    );
    expect(r.reordenado).toBe(true);
    expect(r.itens).toEqual([{ id: "y", t: "troca em 7 dias", relevancia: 0.9 }]);
  });

  it("sem reordenação devolve a ordem original cortada", async () => {
    const r = await reordenarItens(
      { ...base, itens, texto: (i) => i.t, topN: 2 },
      { resolverChave: async () => null, registrar: semRegistro },
    );
    expect(r.reordenado).toBe(false);
    expect(r.itens.map((i) => i.id)).toEqual(["x", "y"]);
  });
});
