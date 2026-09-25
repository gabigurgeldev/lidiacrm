/**
 * O DISPARO SEM TETO DE 500 DESTINATÁRIOS.
 *
 * O teto existia por causa do TRANSPORTE, não do produto: um `.in()` com
 * milhares de ids estoura a URL, a leitura do PostgREST corta em 1.000 linhas
 * em silêncio, e a importação criava os contatos um por um. Tirar o número sem
 * tratar os três trocaria "máximo de 500" por uma falha que não diz nada sobre
 * tamanho — ou, pior, por uma campanha que sai para menos gente do que a tela
 * mostrou.
 *
 * Estes casos prendem o que torna a lista grande SEGURA: consultas em lotes,
 * leitura paginada, ordem da planilha preservada com criação em paralelo, e a
 * mesma pessoa não virando dois contatos por variante de nono dígito.
 */
import { describe, expect, it } from "vitest";

import type { ContatoDoContexto } from "@/lib/automation/guarda-do-contato";
import { montarRecortePorIds, montarRecortePorTags } from "@/lib/bulk-send/montagem";
import { importarLinhas, prepararLinhas } from "@/lib/contacts/importar";
import { comConcorrencia, emLotes, LOTE_DE_FILTRO, PAGINA_DE_LEITURA } from "@/lib/lotes";
import { criarDisparoSchema } from "@/lib/schemas/bulk-sends";

/** `+5511 9 NNNNNNNN` — um celular válido e distinto por índice. */
const tel = (i: number) => `+55119${String(i).padStart(8, "0")}`;

interface Fake {
  cliente: never;
  filtrosIn: Array<{ coluna: string; n: number }>;
  paginas: Array<[number, number]>;
  inserts: number;
}

/**
 * Um cliente Supabase mínimo: responde `contacts` pelo que o teste mandar e
 * REGISTRA o tamanho de cada `.in()` e cada página pedida.
 */
function fakeSupabase(base: { contatos?: ContatoDoContexto[] } = {}): Fake {
  const contatos = base.contatos ?? [];
  const fake: Fake = { cliente: undefined as never, filtrosIn: [], paginas: [], inserts: 0 };
  let seq = 0;

  const from = () => {
    const estado: { in?: { coluna: string; valores: string[] }; range?: [number, number] } = {};
    const resolver = () => {
      if (estado.in?.coluna === "id") {
        const ids = new Set(estado.in.valores);
        return { data: contatos.filter((c) => ids.has(c.id)), error: null };
      }
      if (estado.range) {
        const [a, b] = estado.range;
        return { data: contatos.slice(a, b + 1), error: null };
      }
      // Busca de duplicados por telefone/e-mail: base vazia, ninguém existe.
      return { data: [], error: null };
    };
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "not", "overlaps", "order"]) q[m] = () => q;
    q.in = (coluna: string, valores: string[]) => {
      fake.filtrosIn.push({ coluna, n: valores.length });
      estado.in = { coluna, valores };
      return q;
    };
    q.range = (a: number, b: number) => {
      fake.paginas.push([a, b]);
      estado.range = [a, b];
      return q;
    };
    q.insert = () => {
      fake.inserts += 1;
      return q;
    };
    q.single = async () => ({ data: { id: `novo-${++seq}` }, error: null });
    q.then = (ok: (v: unknown) => unknown, erro: (e: unknown) => unknown) =>
      Promise.resolve(resolver()).then(ok, erro);
    return q;
  };

  fake.cliente = { from, rpc: async () => ({ error: null }) } as never;
  return fake;
}

function csv(linhas: string[]): string {
  return ["nome,telefone", ...linhas].join("\n");
}

describe("a planilha do disparo não tem teto de linhas", () => {
  const grande = csv(Array.from({ length: 600 }, (_, i) => `Pessoa ${i},${tel(i).slice(3)}`));

  it("⭐ o disparo aceita mais de 500 linhas", () => {
    const r = prepararLinhas(grande, null);
    expect(r.erro).toBeNull();
    if (r.erro === null) expect(r.dataRows).toHaveLength(600);
  });

  it("a importação da tela de Contatos segue com o teto — não foi pedida mudança lá", () => {
    expect(prepararLinhas(grande).erro).toMatch(/Máximo de 500 linhas/u);
  });

  it("⭐ criar o disparo aceita mais de 500 ids", () => {
    const ids = Array.from(
      { length: 1200 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    const r = criarDisparoSchema.safeParse({
      name: "Campanha grande",
      channel_session_id: "00000000-0000-4000-8000-00000000abcd",
      mode: "freeform",
      body: "oi",
      audiencia: { kind: "file", contact_ids: ids },
    });
    expect(r.success).toBe(true);
  });
});

describe("importar milhares de linhas", () => {
  it("⭐ busca os já existentes em LOTES — um `.in()` gigante estoura a URL", async () => {
    const fake = fakeSupabase();
    const linhas = Array.from({ length: 1200 }, (_, i) => [`Pessoa ${i}`, tel(i).slice(3)]);
    const r = await importarLinhas(fake.cliente, {
      organizationId: "org",
      userId: "u",
      indices: { name: 0, phone_number: 1 },
      dataRows: linhas,
      requestId: "r",
    });

    expect(r.contatos).toHaveLength(1200);
    expect(fake.filtrosIn.length).toBeGreaterThan(1);
    expect(Math.max(...fake.filtrosIn.map((f) => f.n))).toBeLessThanOrEqual(LOTE_DE_FILTRO);
  });

  it("⭐ a ordem é a da PLANILHA, mesmo criando em paralelo", async () => {
    const fake = fakeSupabase();
    const r = await importarLinhas(fake.cliente, {
      organizationId: "org",
      userId: "u",
      indices: { name: 0, phone_number: 1 },
      dataRows: Array.from({ length: 50 }, (_, i) => [`P${i}`, tel(i).slice(3)]),
      requestId: "r",
    });
    const linhasDaPlanilha = r.contatos.map((c) => c.linha);
    expect(linhasDaPlanilha).toEqual([...linhasDaPlanilha].sort((a, b) => a - b));
  });

  it("⭐ a mesma pessoa com e sem o nono dígito vira UM contato", async () => {
    // Em paralelo, um repetido que escapasse da dedupe nasceria junto como
    // segundo contato. Quem os iguala é a normalização (soma o nono dígito) —
    // o caso prende que ela continua ANTES da dedupe.
    const fake = fakeSupabase();
    const r = await importarLinhas(fake.cliente, {
      organizationId: "org",
      userId: "u",
      indices: { name: 0, phone_number: 1 },
      dataRows: [
        ["Ana", "11999998888"],
        ["Ana de novo", "1199998888"],
      ],
      requestId: "r",
    });
    expect(r.contatos).toHaveLength(1);
    expect(r.resumo.repeated_in_file).toBe(1);
    expect(fake.inserts).toBe(1);
  });
});

describe("o recorte de uma lista grande", () => {
  const muitos = (n: number): ContatoDoContexto[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `id-${i}`,
      phone_number: tel(i),
      is_blocked: false,
    }));

  it("⭐ por ids: consulta em LOTES e não perde ninguém", async () => {
    const contatos = muitos(1000);
    const fake = fakeSupabase({ contatos });
    const r = await montarRecortePorIds(
      fake.cliente,
      "org",
      contatos.map((c) => c.id),
    );

    expect(r.vaoReceber).toBe(1000);
    expect(fake.filtrosIn.every((f) => f.coluna === "id" && f.n <= LOTE_DE_FILTRO)).toBe(true);
  });

  it("⭐ por etiqueta: PAGINA — o PostgREST corta em 1.000 em silêncio", async () => {
    // Sem paginação, uma etiqueta com 2.500 contatos virava campanha de 1.000,
    // e a tela mostrava 1.000 como se fosse a etiqueta inteira.
    const fake = fakeSupabase({ contatos: muitos(2500) });
    const r = await montarRecortePorTags(fake.cliente, "org", ["vip"]);

    expect(r.vaoReceber).toBe(2500);
    expect(fake.paginas).toEqual([
      [0, PAGINA_DE_LEITURA - 1],
      [PAGINA_DE_LEITURA, 2 * PAGINA_DE_LEITURA - 1],
      [2 * PAGINA_DE_LEITURA, 3 * PAGINA_DE_LEITURA - 1],
    ]);
  });
});

describe("lib/lotes", () => {
  it("divide sem perder nem repetir", () => {
    expect(emLotes([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(emLotes([], 3)).toEqual([]);
  });

  it("⭐ concorrência limitada, resultado na ordem dos itens", async () => {
    let emVoo = 0;
    let pico = 0;
    const r = await comConcorrencia([30, 5, 20, 1, 10, 2], 3, async (ms, i) => {
      emVoo += 1;
      pico = Math.max(pico, emVoo);
      await new Promise((ok) => setTimeout(ok, ms));
      emVoo -= 1;
      return i;
    });
    expect(r).toEqual([0, 1, 2, 3, 4, 5]);
    expect(pico).toBeLessThanOrEqual(3);
  });
});
