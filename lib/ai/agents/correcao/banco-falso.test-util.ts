/**
 * Banco em memória para os testes da correção com IA. Aplica DE VERDADE os
 * filtros que a consulta pede (`eq`, `in`, `lt`, `not is null`), então uma
 * consulta que esquece `organization_id` devolve a linha de outra organização
 * — e o teste de isolamento reprova. Grava inserts e updates para conferência.
 */
type Linha = Record<string, unknown>;

export interface Escrita {
  tabela: string;
  tipo: "insert" | "update";
  linha: Linha;
  filtros: Record<string, unknown>;
}

export function bancoFalso(tabelas: Record<string, Linha[]>, opcoes: { falharInsertEm?: string } = {}) {
  const escritas: Escrita[] = [];
  let seq = 0;

  function from(tabela: string) {
    const filtros: Array<(l: Linha) => boolean> = [];
    const igualdades: Record<string, unknown> = {};
    let ordem: { coluna: string; asc: boolean } | null = null;
    let limite: number | null = null;
    let acao: { tipo: "select" } | { tipo: "update"; linha: Linha } | { tipo: "insert"; linha: Linha } = { tipo: "select" };

    const linhas = () => {
      let r = (tabelas[tabela] ?? []).filter((l) => filtros.every((f) => f(l)));
      if (ordem) {
        const { coluna, asc } = ordem;
        r = [...r].sort((a, b) => (String(a[coluna]) < String(b[coluna]) ? -1 : 1) * (asc ? 1 : -1));
      }
      return limite === null ? r : r.slice(0, limite);
    };

    const executar = (): { data: unknown; error: unknown } => {
      if (acao.tipo === "insert") {
        if (opcoes.falharInsertEm === tabela) return { data: null, error: { message: "boom" } };
        const nova = { id: `${tabela}-novo-${++seq}`, ...acao.linha };
        (tabelas[tabela] ??= []).push(nova);
        escritas.push({ tabela, tipo: "insert", linha: acao.linha, filtros: {} });
        return { data: [nova], error: null };
      }
      if (acao.tipo === "update") {
        const alvo = linhas();
        for (const l of alvo) Object.assign(l, acao.linha);
        escritas.push({ tabela, tipo: "update", linha: acao.linha, filtros: { ...igualdades } });
        return { data: alvo, error: null };
      }
      return { data: linhas(), error: null };
    };

    const b: Record<string, unknown> = {
      select: () => b,
      eq: (c: string, v: unknown) => {
        igualdades[c] = v;
        filtros.push((l) => l[c] === v);
        return b;
      },
      in: (c: string, vs: unknown[]) => {
        filtros.push((l) => vs.includes(l[c]));
        return b;
      },
      lt: (c: string, v: number) => {
        filtros.push((l) => (l[c] as number) < v);
        return b;
      },
      not: (c: string, _op: string, _v: null) => {
        filtros.push((l) => l[c] !== null && l[c] !== undefined);
        return b;
      },
      order: (coluna: string, o?: { ascending?: boolean }) => {
        ordem = { coluna, asc: o?.ascending !== false };
        return b;
      },
      limit: (n: number) => {
        limite = n;
        return b;
      },
      update: (linha: Linha) => {
        acao = { tipo: "update", linha };
        return b;
      },
      insert: (linha: Linha) => {
        acao = { tipo: "insert", linha };
        return b;
      },
      maybeSingle: async () => {
        const r = executar();
        return { data: (r.data as Linha[] | null)?.[0] ?? null, error: r.error };
      },
      single: async () => {
        const r = executar();
        const l = (r.data as Linha[] | null)?.[0] ?? null;
        return { data: l, error: r.error ?? (l ? null : { message: "nenhuma linha" }) };
      },
      then: (ok: (v: unknown) => unknown) => Promise.resolve(executar()).then(ok),
    };
    return b;
  }

  return { admin: { from, rpc: async () => ({ data: null, error: null }) }, escritas, tabelas };
}
