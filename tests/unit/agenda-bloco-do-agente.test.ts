/**
 * O BLOCO DA AGENDA no prompt (`lib/agenda/bloco-do-agente.ts`).
 *
 * O que importa medir: o modelo recebe o SLUG que as ferramentas pedem, com
 * nomes de gente e sem uuid nenhum; e agente sem agenda não ganha uma linha.
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  blocoDaAgenda,
  montarBlocoDaAgenda,
  tiposAgendaveis,
  turnoTemAgenda,
  type TipoAgendavel,
} from "@/lib/agenda/bloco-do-agente";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const ORG = "11111111-1111-4111-8111-111111111111";
const T1 = "aaaaaaaa-0000-4000-8000-000000000001";
const T2 = "aaaaaaaa-0000-4000-8000-000000000002";
const ANA = "bbbbbbbb-0000-4000-8000-000000000001";
const BIA = "bbbbbbbb-0000-4000-8000-000000000002";
const CARLA = "bbbbbbbb-0000-4000-8000-000000000003";

/**
 * Dublê mínimo do builder do PostgREST: devolve a tabela pedida e REGISTRA os
 * filtros de `organization_id` — a prova de que nenhuma query sai sem ele.
 */
function dubleDoBanco(tabelas: Record<string, unknown[]>, falhar: string[] = []) {
  const filtrosDeOrg: Record<string, string[]> = {};
  const client = {
    from(tabela: string) {
      const resultado = falhar.includes(tabela)
        ? { data: null, error: { message: "caiu" } }
        : { data: tabelas[tabela] ?? [], error: null };
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "in", "order"]) builder[m] = () => builder;
      builder.eq = (coluna: string, valor: string) => {
        if (coluna === "organization_id") (filtrosDeOrg[tabela] ??= []).push(valor);
        return builder;
      };
      builder.then = (ok: (r: unknown) => unknown) => Promise.resolve(resultado).then(ok);
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, filtrosDeOrg };
}

const BANCO = {
  calendar_event_types: [
    { id: T1, slug: "consulta-inicial", name: "Consulta inicial", duration_minutes: 30, professionals_required: 1 },
    { id: T2, slug: "limpeza", name: "Limpeza de pele", duration_minutes: 60, professionals_required: 2 },
  ],
  calendar_event_type_professionals: [
    { event_type_id: T1, professional_id: ANA },
    { event_type_id: T1, professional_id: BIA },
    { event_type_id: T2, professional_id: ANA },
    { event_type_id: T2, professional_id: BIA },
    { event_type_id: T2, professional_id: CARLA },
  ],
  calendar_professionals: [
    { id: ANA, name: "Ana" },
    { id: BIA, name: "Bia" },
    { id: CARLA, name: "Carla" },
  ],
};

describe("quando o bloco entra", () => {
  it("só com ferramenta de agenda no turno", () => {
    expect(turnoTemAgenda(["crm_find_free_slots"])).toBe(true);
    expect(turnoTemAgenda(["crm_book_appointment"])).toBe(true);
    expect(turnoTemAgenda(["crm_list_appointments", "crm_move_lead"])).toBe(true);
    // CONTROLE: retorno NÃO é agenda — `crm_schedule_followup` não pode puxar o bloco.
    expect(turnoTemAgenda(["crm_schedule_followup", "crm_move_lead"])).toBe(false);
    expect(turnoTemAgenda([])).toBe(false);
  });
});

describe("o texto", () => {
  it("lista slug, nome, duração e quem atende — sem uuid", async () => {
    const { client } = dubleDoBanco(BANCO);
    const bloco = await blocoDaAgenda(client, ORG);
    expect(bloco).toMatch(/^## Agenda/);
    expect(bloco).toContain("- `consulta-inicial` — Consulta inicial (30 min; 1 profissional: Ana ou Bia)");
    expect(bloco).toContain(
      "- `limpeza` — Limpeza de pele (60 min; precisa de 2 profissionais ao mesmo tempo, entre Ana, Bia e Carla)",
    );
    expect(bloco).not.toMatch(UUID);
  });

  it("diz que quem é atendido é a pessoa da conversa", () => {
    const bloco = montarBlocoDaAgenda([
      { slug: "c", nome: "C", duracaoMinutos: 30, profissionaisNecessarios: 1, profissionais: [] },
    ]);
    expect(bloco).toMatch(/pessoa desta conversa/);
  });

  it("nome com crase ou quebra de linha não quebra o slug", () => {
    const tipo: TipoAgendavel = {
      slug: "x",
      nome: "Consulta `especial`\nnova",
      duracaoMinutos: 30,
      profissionaisNecessarios: 1,
      profissionais: [],
    };
    const linha = montarBlocoDaAgenda([tipo]).split("\n")[2]!;
    expect(linha).toBe("- `x` — Consulta especial nova (30 min; 1 profissional)");
  });

  it("organização sem tipo ativo recebe a instrução de não inventar horário", () => {
    expect(montarBlocoDaAgenda([])).toMatch(/Não ofereça horários/);
  });

  it("muitas profissionais viram 'e mais N'", () => {
    const nomes = Array.from({ length: 11 }, (_, i) => `P${i + 1}`);
    const bloco = montarBlocoDaAgenda([
      { slug: "s", nome: "S", duracaoMinutos: 30, profissionaisNecessarios: 1, profissionais: nomes },
    ]);
    expect(bloco).toMatch(/P8 e mais 3/);
  });
});

describe("a leitura", () => {
  it("toda query filtra a organização (service role não tem RLS)", async () => {
    const { client, filtrosDeOrg } = dubleDoBanco(BANCO);
    await tiposAgendaveis(client, ORG);
    expect(Object.keys(filtrosDeOrg).sort()).toEqual([
      "calendar_event_type_professionals",
      "calendar_event_types",
      "calendar_professionals",
    ]);
    for (const valores of Object.values(filtrosDeOrg)) expect(valores).toEqual([ORG]);
  });

  it("falha nas profissionais ainda entrega os slugs — os nomes são conforto", async () => {
    const { client } = dubleDoBanco(BANCO, ["calendar_professionals"]);
    const bloco = await blocoDaAgenda(client, ORG);
    expect(bloco).toContain("- `consulta-inicial` — Consulta inicial (30 min; 1 profissional)");
  });

  it("falha nos tipos vira bloco VAZIO, nunca exceção no turno", async () => {
    const { client } = dubleDoBanco(BANCO, ["calendar_event_types"]);
    await expect(blocoDaAgenda(client, ORG)).resolves.toBe("");
  });
});
