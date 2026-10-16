/**
 * "Responder e ensinar o agente" — a regra, contra um banco em memória.
 *
 * O fake cobre só os encadeamentos que `ensinar.ts` e `criarMaterialDeTexto`
 * usam (select/eq/order/limit/maybeSingle/single, insert, update, rpc). O que
 * se prova aqui é a REGRA: o primeiro ensino cria o material "de todos", os
 * seguintes acrescentam a ele, reensinar atualiza no lugar, e a organização de
 * outra pessoa nunca é tocada. O isolamento real (RLS) é do `test:db`.
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { descartarLacuna, ensinarLacuna, NOME_DO_MATERIAL_ENSINADO } from "./ensinar";

type Linha = Record<string, unknown>;

function bancoEmMemoria(inicial: Record<string, Linha[]>) {
  const tabelas: Record<string, Linha[]> = Object.fromEntries(
    Object.entries(inicial).map(([k, v]) => [k, v.map((l) => ({ ...l }))]),
  );
  const eventos: Linha[] = [];

  function consulta(tabela: string) {
    const filtros: Array<(l: Linha) => boolean> = [];
    let ordem: { coluna: string; asc: boolean } | null = null;
    let limite: number | null = null;
    let acao: { tipo: "select" } | { tipo: "insert"; linhas: Linha[] } | { tipo: "update"; patch: Linha } = {
      tipo: "select",
    };
    const linhasDe = () => (tabelas[tabela] ??= []);
    const executar = (): Linha[] => {
      if (acao.tipo === "insert") {
        const novas = acao.linhas.map((l) => ({ id: randomUUID(), created_at: new Date().toISOString(), ...l }));
        linhasDe().push(...novas);
        return novas;
      }
      let rs = linhasDe().filter((l) => filtros.every((f) => f(l)));
      if (acao.tipo === "update") {
        const patch = acao.patch;
        rs.forEach((l) => Object.assign(l, patch));
      }
      if (ordem) {
        const { coluna, asc } = ordem;
        rs = [...rs].sort((a, b) => ((a[coluna] as number) > (b[coluna] as number) ? 1 : -1) * (asc ? 1 : -1));
      }
      return limite === null ? rs : rs.slice(0, limite);
    };
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => (filtros.push((l) => l[c] === v), q),
      in: (c: string, vs: unknown[]) => (filtros.push((l) => vs.includes(l[c])), q),
      order: (c: string, o?: { ascending?: boolean }) => ((ordem = { coluna: c, asc: o?.ascending ?? true }), q),
      limit: (n: number) => ((limite = n), q),
      insert: (l: Linha | Linha[]) => ((acao = { tipo: "insert", linhas: Array.isArray(l) ? l : [l] }), q),
      update: (patch: Linha) => ((acao = { tipo: "update", patch }), q),
      delete: () => q,
      maybeSingle: async () => ({ data: executar()[0] ?? null, error: null }),
      single: async () => {
        const r = executar()[0];
        return r ? { data: r, error: null } : { data: null, error: { message: "nenhuma linha" } };
      },
      then: (ok: (v: { data: Linha[]; error: null }) => unknown) => Promise.resolve({ data: executar(), error: null }).then(ok),
    };
    return q;
  }

  const admin = {
    from: (t: string) => consulta(t),
    rpc: async (_nome: string, args: Linha) => {
      eventos.push(args);
      return { error: null };
    },
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
  } as unknown as SupabaseClient;

  return { admin, tabelas, eventos };
}

const ORG = "11111111-1111-4111-8111-111111111111";
const OUTRA = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";

function lacuna(id: string, org = ORG): Linha {
  return { id, organization_id: org, pergunta: "vocês têm na cor azul?", status: "aberta", faq_item_id: null };
}
function aviso(refId: string, org = ORG): Linha {
  return { id: randomUUID(), organization_id: org, kind: "knowledge_gap", ref_kind: "knowledge_gap", ref_id: refId, status: "open" };
}

describe("ensinarLacuna", () => {
  it("o primeiro ensino cria o material que TODO agente consulta, com o par dentro, e fecha o aviso", async () => {
    const L = randomUUID();
    const { admin, tabelas } = bancoEmMemoria({ knowledge_gaps: [lacuna(L)], agent_inbox_items: [aviso(L)] });

    const r = await ensinarLacuna(admin, {
      organizationId: ORG,
      lacunaId: L,
      userId: USER,
      pergunta: "Vocês têm a capinha na cor azul?",
      resposta: "Temos só preta e transparente.",
    });

    expect(r.ok).toBe(true);
    const fontes = tabelas.ai_knowledge_sources!;
    expect(fontes).toHaveLength(1);
    expect(fontes[0]).toMatchObject({ name: NOME_DO_MATERIAL_ENSINADO, source_type: "faq", todos_os_agentes: true, organization_id: ORG });
    expect(tabelas.ai_faq_items).toEqual([
      expect.objectContaining({ question: "Vocês têm a capinha na cor azul?", answer: "Temos só preta e transparente." }),
    ]);
    expect(tabelas.knowledge_gaps![0]).toMatchObject({ status: "respondida", respondida_por: USER });
    expect(tabelas.knowledge_gaps![0]!.faq_item_id).toBe(tabelas.ai_faq_items![0]!.id);
    expect(tabelas.agent_inbox_items![0]!.status).toBe("resolved");
  });

  it("os ensinos seguintes acrescentam ao MESMO material, na posição seguinte, e pedem indexação", async () => {
    const [L1, L2] = [randomUUID(), randomUUID()];
    const { admin, tabelas, eventos } = bancoEmMemoria({ knowledge_gaps: [lacuna(L1), lacuna(L2)] });
    await ensinarLacuna(admin, { organizationId: ORG, lacunaId: L1, userId: USER, pergunta: "Entregam no sábado?", resposta: "Sim, até 14h." });
    const antes = eventos.length;

    const r = await ensinarLacuna(admin, { organizationId: ORG, lacunaId: L2, userId: USER, pergunta: "Aceitam Pix?", resposta: "Aceitamos." });

    expect(r.ok).toBe(true);
    expect(tabelas.ai_knowledge_sources).toHaveLength(1);
    expect(tabelas.ai_faq_items!.map((i) => i.position)).toEqual([0, 1]);
    expect(eventos.length).toBe(antes + 1);
    expect(eventos.at(-1)).toMatchObject({ p_event_type: "knowledge_source.updated", p_organization_id: ORG });
  });

  it("reensinar a mesma pergunta atualiza o par no lugar — nunca duas respostas para ela", async () => {
    const L = randomUUID();
    const { admin, tabelas } = bancoEmMemoria({ knowledge_gaps: [lacuna(L)] });
    await ensinarLacuna(admin, { organizationId: ORG, lacunaId: L, userId: USER, pergunta: "Abre domingo?", resposta: "Não." });

    await ensinarLacuna(admin, { organizationId: ORG, lacunaId: L, userId: USER, pergunta: "Abre domingo?", resposta: "Sim, das 9h às 13h." });

    expect(tabelas.ai_faq_items).toHaveLength(1);
    expect(tabelas.ai_faq_items![0]!.answer).toBe("Sim, das 9h às 13h.");
  });

  it("lacuna de OUTRA organização não é encontrada, e nada é gravado", async () => {
    const L = randomUUID();
    const { admin, tabelas } = bancoEmMemoria({ knowledge_gaps: [lacuna(L, OUTRA)] });

    const r = await ensinarLacuna(admin, { organizationId: ORG, lacunaId: L, userId: USER, pergunta: "x?", resposta: "y" });

    expect(r).toMatchObject({ ok: false, motivo: "nao_encontrada" });
    expect(tabelas.ai_knowledge_sources ?? []).toHaveLength(0);
    expect(tabelas.knowledge_gaps![0]!.status).toBe("aberta");
  });
});

describe("descartarLacuna", () => {
  it("para de avisar: status descartada e o aviso aberto é fechado — só na própria organização", async () => {
    const L = randomUUID();
    const { admin, tabelas } = bancoEmMemoria({
      knowledge_gaps: [lacuna(L)],
      agent_inbox_items: [aviso(L), aviso(L, OUTRA)],
    });

    expect((await descartarLacuna(admin, { organizationId: ORG, lacunaId: L })).ok).toBe(true);
    expect(tabelas.knowledge_gaps![0]!.status).toBe("descartada");
    expect(tabelas.agent_inbox_items!.map((a) => a.status)).toEqual(["resolved", "open"]);
    expect((await descartarLacuna(admin, { organizationId: OUTRA, lacunaId: L })).ok).toBe(false);
  });
});
