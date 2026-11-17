import { beforeEach, describe, expect, it, vi } from "vitest";

const reordenarItens = vi.fn();
vi.mock("@/lib/ai/rerank/openrouter", () => ({
  reordenarItens: (...args: unknown[]) => reordenarItens(...args),
}));

import {
  crmSearchProducts,
  ordenarPorCasamento,
  palavrasDoProduto,
  textoDoProduto,
} from "./comercio";

/**
 * A busca de produto antiga era `ilike('%termo inteiro%')` só no título:
 * "vestido azul" não achava "Vestido Longo Azul". Estes casos fixam o contrato
 * novo — palavras soltas viram candidatos, e a ordem é do rerank quando ele
 * responde, ou da contagem de palavras quando não.
 */

describe("palavrasDoProduto", () => {
  it("mantém acento, tira palavra vazia e pontuação", () => {
    expect(palavrasDoProduto("Tem calça jeans, tamanho 42?")).toEqual(["calça", "jeans", "tamanho", "42"]);
  });

  it("nunca devolve vírgula nem parêntese (sintaxe do filtro or)", () => {
    for (const w of palavrasDoProduto("blusa (preta), m,g")) expect(w).toMatch(/^[\p{L}\p{N}]+$/u);
  });

  it("limita a 6 palavras", () => {
    expect(palavrasDoProduto("um dois três quatro cinco seis sete oito nove")).toHaveLength(6);
  });
});

describe("ordenarPorCasamento", () => {
  it("palavra no título vale mais que na descrição", () => {
    const produtos = [
      { title: "Saia midi", description: "combina com vestido azul" },
      { title: "Vestido Longo Azul", description: "" },
    ];
    expect(ordenarPorCasamento(produtos, ["vestido", "azul"])[0]?.title).toBe("Vestido Longo Azul");
  });
});

describe("textoDoProduto", () => {
  it("tira HTML da descrição", () => {
    expect(textoDoProduto({ title: "Bolsa", description: "<p>Couro <b>legítimo</b></p>" })).toBe("Bolsa\nCouro legítimo");
  });
});

function supabaseFalso(linhas: unknown[]) {
  const chamadas: Array<[string, unknown[]]> = [];
  const q: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "limit", "or", "gt"]) {
    q[m] = (...args: unknown[]) => {
      chamadas.push([m, args]);
      return q;
    };
  }
  q.then = (resolve: (v: unknown) => unknown) => resolve({ data: linhas, error: null });
  return { supabase: q, chamadas };
}

describe("crm_search_products", () => {
  beforeEach(() => {
    reordenarItens.mockReset();
  });

  it("busca por palavra em título OU descrição, sempre filtrando a org do contexto", async () => {
    const { supabase, chamadas } = supabaseFalso([]);
    reordenarItens.mockResolvedValue({ itens: [], reordenado: false });
    await crmSearchProducts.handler(
      { termo: "vestido azul", limite: 5, somente_disponiveis: true },
      { supabase, organizationId: "org-1" } as never,
    );
    expect(chamadas).toContainEqual(["eq", ["organization_id", "org-1"]]);
    expect(chamadas).toContainEqual([
      "or",
      ["title.ilike.%vestido%,description.ilike.%vestido%,title.ilike.%azul%,description.ilike.%azul%"],
    ]);
    expect(chamadas).toContainEqual(["gt", ["available_qty", 0]]);
  });

  it("com rerank, devolve a ordem dele e a relevância", async () => {
    const linhas = [
      { id: "a", title: "Saia", description: "vestido azul" },
      { id: "b", title: "Vestido Azul", description: "" },
    ];
    const { supabase } = supabaseFalso(linhas);
    reordenarItens.mockImplementation(async (args: { itens: Array<{ id: string }>; ponto: string; organizationId: string }) => {
      expect(args.ponto).toBe("produtos");
      expect(args.organizationId).toBe("org-1");
      return { itens: [{ ...args.itens[0], relevancia: 0.9 }], reordenado: true };
    });
    const r = (await crmSearchProducts.handler(
      { termo: "vestido azul", limite: 1, somente_disponiveis: false },
      { supabase, organizationId: "org-1" } as never,
    )) as { produtos: Array<{ id: string; relevancia?: number }> };
    // O pré-ordenamento já põe o título casado na frente antes do rerank.
    expect(r.produtos).toEqual([{ id: "b", title: "Vestido Azul", description: "", relevancia: 0.9 }]);
  });

  it("sem rerank, não inventa campo relevancia e avisa quando nada casa", async () => {
    const { supabase } = supabaseFalso([]);
    reordenarItens.mockResolvedValue({ itens: [], reordenado: false });
    const r = (await crmSearchProducts.handler(
      { termo: "xyz123", limite: 5, somente_disponiveis: true },
      { supabase, organizationId: "org-1" } as never,
    )) as { aviso?: string };
    expect(r.aviso).toBe("nada parecido em estoque");
  });
});
