/**
 * TIRAR A ÚLTIMA HABILITAÇÃO DE UM SERVIÇO É RECUSADO (422).
 *
 * Tipo sem habilitação nenhuma é "aberto": qualquer profissional ativa serve
 * (regra de instalação antiga, no marcar e na consulta). Então desmarcar a única
 * profissional de um serviço não o deixava "sem ninguém" — deixava com TODO
 * MUNDO, e a IA passava a oferecer horário de quem nunca fez aquilo.
 *
 * Duas portas escrevem a habilitação, as duas medidas aqui:
 *   - `gravarTiposDaProfissional` (tela da profissional: "que serviços ela faz");
 *   - `PATCH /api/v1/agenda/tipos` com `professional_ids: []` (tela do serviço).
 *
 * E em ambas a recusa vem ANTES de qualquer escrita.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

const { requireRole } = await import("@/lib/auth/require-role");
const { createAdminClient } = await import("@/lib/supabase/admin");
const { gravarTiposDaProfissional, RecusaDaProfissional } = await import(
  "@/app/api/v1/agenda/profissionais/_itens"
);
const { PATCH } = await import("@/app/api/v1/agenda/tipos/route");

const ORG = "11111111-1111-4111-8111-111111111111";
const TIPO_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TIPO_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ANA = "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0";
const BIA = "b0b0b0b0-b0b0-4b0b-8b0b-b0b0b0b0b0b0";

type Linha = Record<string, unknown>;

/** Banco em memória mínimo: filtra de verdade, e registra cada escrita. */
let tabelas: Record<string, Linha[]>;
let escritas: { tabela: string; op: string }[];

function client(): SupabaseClient {
  return {
    from(tabela: string) {
      const preds: ((l: Linha) => boolean)[] = [];
      let op = "select";
      const b: Record<string, unknown> = {};
      const linhas = () => (tabelas[tabela] ?? []).filter((l) => preds.every((p) => p(l)));
      b.select = () => b;
      b.eq = (c: string, v: unknown) => (preds.push((l) => l[c] === v), b);
      b.neq = (c: string, v: unknown) => (preds.push((l) => l[c] !== v), b);
      b.in = (c: string, vs: unknown[]) => (preds.push((l) => vs.includes(l[c])), b);
      b.not = () => b;
      b.order = () => b;
      b.limit = () => b;
      b.update = () => ((op = "update"), escritas.push({ tabela, op }), b);
      b.delete = () => ((op = "delete"), escritas.push({ tabela, op }), b);
      b.upsert = async () => (escritas.push({ tabela, op: "upsert" }), { error: null });
      b.maybeSingle = async () => ({ data: linhas()[0] ?? null, error: null });
      b.then = (ok: (v: unknown) => unknown) =>
        Promise.resolve({ data: op === "select" ? linhas() : null, error: null }).then(ok);
      return b;
    },
  } as unknown as SupabaseClient;
}

function habilitacao(event_type_id: string, professional_id: string, organization_id = ORG): Linha {
  return { organization_id, event_type_id, professional_id };
}

beforeEach(() => {
  vi.clearAllMocks();
  escritas = [];
  tabelas = {
    calendar_event_types: [
      { organization_id: ORG, id: TIPO_A, name: "Limpeza de pele" },
      { organization_id: ORG, id: TIPO_B, name: "Massagem" },
    ],
    calendar_professionals: [
      { organization_id: ORG, id: ANA },
      { organization_id: ORG, id: BIA },
    ],
    calendar_event_type_professionals: [],
  };
});

describe("gravarTiposDaProfissional", () => {
  it("tirar a ÚNICA habilitada de um serviço: 422 nomeando o serviço, sem escrever nada", async () => {
    tabelas.calendar_event_type_professionals = [habilitacao(TIPO_A, ANA), habilitacao(TIPO_B, ANA)];
    const erro = await gravarTiposDaProfissional(client(), ORG, ANA, [TIPO_B]).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(RecusaDaProfissional);
    expect(erro).toMatchObject({ status: 422, codigo: "validation_failed" });
    expect((erro as Error).message).toMatch(/"Limpeza de pele" ficaria sem nenhuma profissional/);
    expect((erro as Error).message).toMatch(/habilite outra antes/);
    expect(escritas).toEqual([]);
  });

  it("zerar tudo também é recusado quando algum serviço só tinha ela", async () => {
    tabelas.calendar_event_type_professionals = [habilitacao(TIPO_A, ANA)];
    await expect(gravarTiposDaProfissional(client(), ORG, ANA, [])).rejects.toBeInstanceOf(RecusaDaProfissional);
    expect(escritas).toEqual([]);
  });

  it("CONTROLE: o serviço que sai tem OUTRA habilitada — grava", async () => {
    tabelas.calendar_event_type_professionals = [habilitacao(TIPO_A, ANA), habilitacao(TIPO_A, BIA)];
    await gravarTiposDaProfissional(client(), ORG, ANA, []);
    expect(escritas.map((e) => e.op)).toContain("delete");
  });

  it("habilitação de OUTRA organização não conta como 'outra profissional'", async () => {
    tabelas.calendar_event_type_professionals = [
      habilitacao(TIPO_A, ANA),
      habilitacao(TIPO_A, BIA, "99999999-9999-4999-8999-999999999999"),
    ];
    await expect(gravarTiposDaProfissional(client(), ORG, ANA, [])).rejects.toBeInstanceOf(RecusaDaProfissional);
  });

  it("CONTROLE: só ACRESCENTAR serviço nunca é recusado", async () => {
    tabelas.calendar_event_type_professionals = [habilitacao(TIPO_A, ANA)];
    await gravarTiposDaProfissional(client(), ORG, ANA, [TIPO_A, TIPO_B]);
    expect(escritas.map((e) => e.op)).toContain("upsert");
  });
});

describe("PATCH /api/v1/agenda/tipos com professional_ids: []", () => {
  beforeEach(() => {
    vi.mocked(requireRole).mockResolvedValue({ ok: true, user: { id: "u-1" }, org: { orgId: ORG } } as never);
    vi.mocked(createAdminClient).mockReturnValue(client() as never);
  });

  const patch = (corpo: unknown) =>
    PATCH(
      new NextRequest("http://localhost/api/v1/agenda/tipos", {
        method: "PATCH",
        body: JSON.stringify(corpo),
        headers: { "content-type": "application/json" },
      }),
    );

  it("tipo que TEM habilitada: 422, e nem as outras colunas são gravadas", async () => {
    tabelas.calendar_event_type_professionals = [habilitacao(TIPO_A, ANA)];
    const res = await patch({ id: TIPO_A, name: "Limpeza profunda", professional_ids: [] });
    expect(res.status).toBe(422);
    const corpo = (await res.json()) as { error: { code: string; message: string } };
    expect(corpo.error.code).toBe("validation_failed");
    expect(corpo.error.message).toMatch(/ficaria sem nenhuma profissional/);
    expect(escritas).toEqual([]);
  });

  it("CONTROLE: tipo que já não tinha ninguém — esvaziar de novo não é recusa", async () => {
    const res = await patch({ id: TIPO_A, professional_ids: [] });
    expect(res.status).toBe(200);
  });

  it("CONTROLE: trocar o conjunto por outro NÃO vazio passa", async () => {
    tabelas.calendar_event_type_professionals = [habilitacao(TIPO_A, ANA)];
    const res = await patch({ id: TIPO_A, professional_ids: [BIA] });
    expect(res.status).toBe(200);
  });
});
