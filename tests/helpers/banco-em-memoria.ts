/**
 * Um Supabase de mentira que APLICA os filtros — `eq`, `neq`, `in`, `contains`,
 * `ilike` — sobre tabelas em memória, e registra cada escrita.
 *
 * Existe para os testes do catálogo de tags (migration 0248). Stub de linha
 * fixa deixaria passar "tag de outra organização", com o `eq("organization_id")`
 * apagado do código: mediria o dublê, não a regra.
 *
 * Só o que esses testes usam; não é um PostgREST.
 */

type Linha = Record<string, unknown>;

export interface Escrita {
  tabela: string;
  op: "insert" | "update" | "delete";
  valores?: Linha | Linha[];
  filtros: Array<[string, string, unknown]>;
}

export interface BancoEmMemoria {
  tabelas: Record<string, Linha[]>;
  escritas: Escrita[];
  rpcs: Array<{ nome: string; args: Record<string, unknown> }>;
  /** Respostas fixas de RPC por nome; padrão `{ data: null, error: null }`. */
  respostasDeRpc: Record<string, (args: Record<string, unknown>) => { data: unknown; error: unknown }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any;
}

function casa(linha: Linha, filtros: Array<[string, string, unknown]>): boolean {
  return filtros.every(([op, col, val]) => {
    const v = linha[col];
    switch (op) {
      case "eq":
        return v === val;
      case "neq":
        return v !== val;
      case "in":
        return (val as unknown[]).includes(v);
      case "contains":
        return Array.isArray(v) && (val as unknown[]).every((x) => (v as unknown[]).includes(x));
      case "ilike": {
        const padrao = String(val).replace(/\\([\\%_])/g, "$1");
        return typeof v === "string" && v.toLowerCase() === padrao.toLowerCase();
      }
      default:
        throw new Error(`filtro não suportado no dublê: ${op}`);
    }
  });
}

let seq = 0;

export function bancoEmMemoria(inicial: Record<string, Linha[]> = {}): BancoEmMemoria {
  const banco: BancoEmMemoria = {
    tabelas: Object.fromEntries(Object.entries(inicial).map(([k, v]) => [k, v.map((l) => ({ ...l }))])),
    escritas: [],
    rpcs: [],
    respostasDeRpc: {},
    client: null,
  };

  function consulta(tabela: string) {
    const filtros: Array<[string, string, unknown]> = [];
    let op: "select" | "insert" | "update" | "delete" = "select";
    let valores: Linha | Linha[] | undefined;
    let contar = false;
    let cabeca = false;
    let limite: number | null = null;
    let ordem: { col: string; asc: boolean } | null = null;

    const linhas = () => (banco.tabelas[tabela] ??= []);

    function executar(): { data: unknown; error: unknown; count?: number } {
      if (op === "insert") {
        const novas = (Array.isArray(valores) ? valores : [valores!]).map((v) => ({
          id: v.id ?? `gerado-${++seq}`,
          created_at: new Date().toISOString(),
          ...v,
        }));
        banco.escritas.push({ tabela, op, valores: novas, filtros: [] });
        linhas().push(...novas);
        return { data: Array.isArray(valores) ? novas : novas[0], error: null };
      }
      if (op === "update") {
        const alvo = linhas().filter((l) => casa(l, filtros));
        banco.escritas.push({ tabela, op, valores, filtros: [...filtros] });
        for (const l of alvo) Object.assign(l, valores);
        return { data: alvo, error: null };
      }
      if (op === "delete") {
        banco.escritas.push({ tabela, op, filtros: [...filtros] });
        banco.tabelas[tabela] = linhas().filter((l) => !casa(l, filtros));
        return { data: null, error: null };
      }
      let r = linhas().filter((l) => casa(l, filtros));
      if (ordem) {
        const { col, asc } = ordem;
        r = [...r].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1));
      }
      if (limite !== null) r = r.slice(0, limite);
      if (contar) return { data: cabeca ? null : r, error: null, count: r.length };
      return { data: r, error: null };
    }

    const q = {
      select(_cols?: string, o?: { count?: string; head?: boolean }) {
        if (o?.count) contar = true;
        if (o?.head) cabeca = true;
        return q;
      },
      insert(v: Linha | Linha[]) {
        op = "insert";
        valores = v;
        return q;
      },
      update(v: Linha) {
        op = "update";
        valores = v;
        return q;
      },
      delete() {
        op = "delete";
        return q;
      },
      eq: (c: string, v: unknown) => (filtros.push(["eq", c, v]), q),
      neq: (c: string, v: unknown) => (filtros.push(["neq", c, v]), q),
      in: (c: string, v: unknown[]) => (filtros.push(["in", c, v]), q),
      contains: (c: string, v: unknown[]) => (filtros.push(["contains", c, v]), q),
      ilike: (c: string, v: string) => (filtros.push(["ilike", c, v]), q),
      order: (col: string, o?: { ascending?: boolean }) => ((ordem = { col, asc: o?.ascending !== false }), q),
      limit: (n: number) => ((limite = n), q),
      maybeSingle: async () => {
        const r = executar();
        const d = r.data as Linha[] | Linha | null;
        return { data: Array.isArray(d) ? (d[0] ?? null) : d, error: r.error };
      },
      single: async () => {
        const r = executar();
        const d = r.data as Linha[] | Linha | null;
        const um = Array.isArray(d) ? d[0] : d;
        return um ? { data: um, error: null } : { data: null, error: { message: "nenhuma linha" } };
      },
      then<T>(res: (v: { data: unknown; error: unknown; count?: number }) => T, rej?: (e: unknown) => T) {
        try {
          return Promise.resolve(executar()).then(res, rej);
        } catch (e) {
          return rej ? Promise.resolve(rej(e)) : Promise.reject(e);
        }
      },
    };
    return q;
  }

  banco.client = {
    from: (tabela: string) => consulta(tabela),
    rpc: (nome: string, args: Record<string, unknown>) => {
      banco.rpcs.push({ nome, args });
      const r = banco.respostasDeRpc[nome]?.(args) ?? { data: null, error: null };
      return Object.assign(Promise.resolve(r), {
        then: <T>(res: (v: typeof r) => T) => Promise.resolve(r).then(res),
      });
    },
  };
  return banco;
}
