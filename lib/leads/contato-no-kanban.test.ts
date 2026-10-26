import { beforeEach, describe, expect, it, vi } from "vitest";

const createLeadHandler = vi.fn();
const moveLeadHandler = vi.fn();
const aplicarTagDaColuna = vi.fn();

vi.mock("@/app/api/v1/leads/_handler", () => ({
  createLeadHandler: (...a: unknown[]) => createLeadHandler(...a),
  moveLeadHandler: (...a: unknown[]) => moveLeadHandler(...a),
}));
vi.mock("@/lib/leads/activity-emitter", () => ({ emitLeadActivity: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/tags/tag-no-kanban", () => ({
  aplicarTagDaColuna: (...a: unknown[]) => aplicarTagDaColuna(...a),
}));

import { ApiError } from "@/lib/api/types";
import { colocarContatoNaColuna, lerKanbansDoContato } from "@/lib/leads/contato-no-kanban";
import { bancoEmMemoria } from "@/tests/helpers/banco-em-memoria";

/**
 * "Colocar o contato numa fase" pelo inbox: move o negócio aberto dele naquele
 * Kanban, ou cria — nunca um segundo card. E a coluna dá as tags dela.
 */

const ORG = "org-1";
const CTX = { organization_id: ORG, actor: { type: "user" as const, id: "u-1" }, requestId: "req" };

function db() {
  return bancoEmMemoria({
    crm_stages: [
      { id: "s-novo", organization_id: ORG, pipeline_id: "p-1", name: "Novo", is_archived: false },
      { id: "s-prop", organization_id: ORG, pipeline_id: "p-1", name: "Proposta", is_archived: false },
      { id: "s-velha", organization_id: ORG, pipeline_id: "p-1", name: "Velha", is_archived: true },
      { id: "s-alheia", organization_id: "org-2", pipeline_id: "p-x", name: "Alheia", is_archived: false },
    ],
    contacts: [
      { id: "c-1", organization_id: ORG, display_name: "Maria Souza", is_anonymized: false },
      { id: "c-anon", organization_id: ORG, display_name: "Cliente Anonimizado #1", is_anonymized: true },
    ],
    crm_leads: [],
    crm_pipelines: [{ id: "p-1", organization_id: ORG, name: "Vendas", is_default: true, is_archived: false, position: 1 }],
  });
}

async function recusa(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error("esperava recusa");
}

beforeEach(() => {
  createLeadHandler.mockReset().mockResolvedValue({ id: "lead-novo" });
  moveLeadHandler.mockReset().mockResolvedValue({});
  aplicarTagDaColuna.mockReset().mockResolvedValue({ tagsAcrescentadas: ["VIP"], efeitos: [] });
});

describe("colocarContatoNaColuna", () => {
  it("sem negócio aberto no Kanban: cria na coluna e aplica as tags dela", async () => {
    const b = db();
    const r = await colocarContatoNaColuna(b.client, CTX, { contactId: "c-1", stageId: "s-prop" });
    expect(r).toMatchObject({ acao: "criado", lead_id: "lead-novo", tags_da_coluna: ["VIP"] });
    expect(createLeadHandler.mock.calls[0]![2]).toMatchObject({ pipeline_id: "p-1", stage_id: "s-prop", contact_id: "c-1", title: "Maria Souza" });
    expect(aplicarTagDaColuna).toHaveBeenCalledWith(b.client, CTX, { leadId: "lead-novo", stageId: "s-prop" });
  });

  it("com negócio aberto em outra coluna: MOVE, não cria", async () => {
    const b = db();
    b.tabelas.crm_leads!.push({ id: "l-1", organization_id: ORG, contact_id: "c-1", pipeline_id: "p-1", stage_id: "s-novo", status: "open" });
    const r = await colocarContatoNaColuna(b.client, CTX, { contactId: "c-1", stageId: "s-prop" });
    expect(r.acao).toBe("movido");
    expect(createLeadHandler).not.toHaveBeenCalled();
    expect(moveLeadHandler).toHaveBeenCalledWith(b.client, CTX, "l-1", { to_stage_id: "s-prop" });
  });

  it("já na coluna: nada muda, nem tag", async () => {
    const b = db();
    b.tabelas.crm_leads!.push({ id: "l-1", organization_id: ORG, contact_id: "c-1", pipeline_id: "p-1", stage_id: "s-prop", status: "open" });
    const r = await colocarContatoNaColuna(b.client, CTX, { contactId: "c-1", stageId: "s-prop" });
    expect(r.acao).toBe("ja_estava");
    expect(moveLeadHandler).not.toHaveBeenCalled();
    expect(aplicarTagDaColuna).not.toHaveBeenCalled();
  });

  it("dois negócios abertos no mesmo Kanban: 409, sem adivinhar", async () => {
    const b = db();
    b.tabelas.crm_leads!.push(
      { id: "l-1", organization_id: ORG, contact_id: "c-1", pipeline_id: "p-1", stage_id: "s-novo", status: "open" },
      { id: "l-2", organization_id: ORG, contact_id: "c-1", pipeline_id: "p-1", stage_id: "s-novo", status: "open" },
    );
    const e = await recusa(colocarContatoNaColuna(b.client, CTX, { contactId: "c-1", stageId: "s-prop" }));
    expect(e.code).toBe("ambiguous_open_leads");
    expect(moveLeadHandler).not.toHaveBeenCalled();
  });

  it("coluna de outra organização ou arquivada: 404", async () => {
    expect((await recusa(colocarContatoNaColuna(db().client, CTX, { contactId: "c-1", stageId: "s-alheia" }))).status).toBe(404);
    expect((await recusa(colocarContatoNaColuna(db().client, CTX, { contactId: "c-1", stageId: "s-velha" }))).status).toBe(404);
  });

  it("contato anonimizado (LGPD): 403, nada criado", async () => {
    const e = await recusa(colocarContatoNaColuna(db().client, CTX, { contactId: "c-anon", stageId: "s-prop" }));
    expect(e.status).toBe(403);
    expect(createLeadHandler).not.toHaveBeenCalled();
  });
});

describe("lerKanbansDoContato", () => {
  it("Kanbans ativos com colunas ativas, e só os negócios ABERTOS do contato", async () => {
    const b = db();
    b.tabelas.crm_leads!.push(
      { id: "l-aberto", organization_id: ORG, contact_id: "c-1", pipeline_id: "p-1", stage_id: "s-novo", status: "open", title: "A", updated_at: "2" },
      { id: "l-ganho", organization_id: ORG, contact_id: "c-1", pipeline_id: "p-1", stage_id: "s-novo", status: "won", title: "B", updated_at: "1" },
    );
    const r = await lerKanbansDoContato(b.client, ORG, "c-1");
    expect(r.kanbans).toHaveLength(1);
    expect(r.kanbans[0]!.stages.map((s) => s.id)).toEqual(["s-novo", "s-prop"]);
    expect(r.negocios.map((n) => n.id)).toEqual(["l-aberto"]);
  });
});
