import { beforeEach, describe, expect, it, vi } from "vitest";

const createLeadHandler = vi.fn();
const moveLeadHandler = vi.fn();
const emitLeadActivity = vi.fn();

vi.mock("@/app/api/v1/leads/_handler", () => ({
  createLeadHandler: (...a: unknown[]) => createLeadHandler(...a),
  moveLeadHandler: (...a: unknown[]) => moveLeadHandler(...a),
}));
vi.mock("@/lib/leads/activity-emitter", () => ({
  emitLeadActivity: (...a: unknown[]) => emitLeadActivity(...a),
}));

import { aplicarTagDaColuna, aplicarTagsNoKanban } from "@/lib/tags/tag-no-kanban";
import { bancoEmMemoria } from "@/tests/helpers/banco-em-memoria";

/**
 * A sincronia tag ↔ coluna do Kanban (migration 0248), nos dois sentidos.
 *
 * O dublê aplica os filtros de verdade: "tag de outra organização com o mesmo
 * nome" só fica fora porque o código filtra `organization_id` — apagar o filtro
 * reprova o caso de isolamento abaixo.
 */

const ORG = "org-1";
const OUTRA = "org-2";
const VENDAS = "pipe-vendas";
const SUPORTE = "pipe-suporte";
const CTX = { organization_id: ORG, actor: { type: "user" as const, id: "u-1" }, requestId: "req-1" };

function base() {
  return bancoEmMemoria({
    crm_tags: [
      { id: "t-vip", organization_id: ORG, name: "VIP", is_archived: false },
      { id: "t-orc", organization_id: ORG, name: "Orçamento", is_archived: false },
      { id: "t-velha", organization_id: ORG, name: "Antiga", is_archived: true },
      { id: "t-solta", organization_id: ORG, name: "Sem coluna", is_archived: false },
      { id: "t-vip-2", organization_id: OUTRA, name: "VIP", is_archived: false },
    ],
    crm_stage_tags: [
      { organization_id: ORG, pipeline_id: VENDAS, stage_id: "s-proposta", tag_id: "t-vip" },
      { organization_id: ORG, pipeline_id: VENDAS, stage_id: "s-orc", tag_id: "t-orc" },
      { organization_id: ORG, pipeline_id: VENDAS, stage_id: "s-proposta", tag_id: "t-velha" },
      { organization_id: OUTRA, pipeline_id: "pipe-alheio", stage_id: "s-alheia", tag_id: "t-vip-2" },
    ],
    crm_stages: [
      { id: "s-novo", organization_id: ORG, pipeline_id: VENDAS, name: "Novo", is_archived: false },
      { id: "s-proposta", organization_id: ORG, pipeline_id: VENDAS, name: "Proposta", is_archived: false },
      { id: "s-orc", organization_id: ORG, pipeline_id: VENDAS, name: "Orçamento", is_archived: false },
      { id: "s-alheia", organization_id: OUTRA, pipeline_id: "pipe-alheio", name: "Alheia", is_archived: false },
      { id: "s-sup-vip", organization_id: ORG, pipeline_id: SUPORTE, name: "Prioridade", is_archived: false },
    ],
    crm_pipelines: [
      { id: VENDAS, organization_id: ORG, name: "Vendas", is_archived: false },
      { id: SUPORTE, organization_id: ORG, name: "Suporte", is_archived: false },
      { id: "pipe-alheio", organization_id: OUTRA, name: "Alheio", is_archived: false },
    ],
    contacts: [
      { id: "c-1", organization_id: ORG, display_name: "Maria Souza", tags: [], is_anonymized: false },
    ],
    crm_leads: [],
  });
}

beforeEach(() => {
  createLeadHandler.mockReset().mockImplementation(async () => ({ id: "lead-novo" }));
  moveLeadHandler.mockReset().mockResolvedValue({});
  emitLeadActivity.mockReset().mockResolvedValue({ ok: true });
});

describe("aplicarTagsNoKanban — a tag leva o contato à coluna", () => {
  it("tag sem coluna não toca no Kanban", async () => {
    const db = base();
    const r = await aplicarTagsNoKanban(db.client, CTX, { contactId: "c-1", tagsAdicionadas: ["Sem coluna"] });
    expect(r).toEqual([]);
    expect(createLeadHandler).not.toHaveBeenCalled();
    expect(moveLeadHandler).not.toHaveBeenCalled();
  });

  it("contato sem negócio no Kanban: o negócio NASCE na coluna da tag, com o nome do contato", async () => {
    const db = base();
    const r = await aplicarTagsNoKanban(db.client, CTX, { contactId: "c-1", tagsAdicionadas: ["VIP"] });
    expect(createLeadHandler).toHaveBeenCalledTimes(1);
    expect(createLeadHandler.mock.calls[0]![2]).toMatchObject({
      pipeline_id: VENDAS,
      stage_id: "s-proposta",
      contact_id: "c-1",
      title: "Maria Souza",
    });
    expect(r).toEqual([
      expect.objectContaining({ acao: "criado", stage_name: "Proposta", pipeline_name: "Vendas", lead_id: "lead-novo" }),
    ]);
    // A timeline diz de onde o card veio — "apareceu sozinho" é como se perde a confiança.
    expect(emitLeadActivity.mock.calls[0]![1]).toMatchObject({ type: "lead_created", leadId: "lead-novo" });
  });

  it("contato com negócio aberto em outra coluna: MOVE, não cria um segundo card", async () => {
    const db = base();
    db.tabelas.crm_leads!.push({ id: "l-1", organization_id: ORG, contact_id: "c-1", pipeline_id: VENDAS, stage_id: "s-novo", status: "open" });
    const r = await aplicarTagsNoKanban(db.client, CTX, { contactId: "c-1", tagsAdicionadas: ["VIP"] });
    expect(createLeadHandler).not.toHaveBeenCalled();
    expect(moveLeadHandler).toHaveBeenCalledWith(db.client, CTX, "l-1", expect.objectContaining({ to_stage_id: "s-proposta" }));
    expect(r[0]).toMatchObject({ acao: "movido", lead_id: "l-1" });
  });

  it("negócio já na coluna: não move de novo", async () => {
    const db = base();
    db.tabelas.crm_leads!.push({ id: "l-1", organization_id: ORG, contact_id: "c-1", pipeline_id: VENDAS, stage_id: "s-proposta", status: "open" });
    const r = await aplicarTagsNoKanban(db.client, CTX, { contactId: "c-1", tagsAdicionadas: ["VIP"] });
    expect(moveLeadHandler).not.toHaveBeenCalled();
    expect(r[0]).toMatchObject({ acao: "ja_estava" });
  });

  it("negócio GANHO/PERDIDO não conta como aberto: nasce um novo", async () => {
    const db = base();
    db.tabelas.crm_leads!.push({ id: "l-velho", organization_id: ORG, contact_id: "c-1", pipeline_id: VENDAS, stage_id: "s-novo", status: "won" });
    await aplicarTagsNoKanban(db.client, CTX, { contactId: "c-1", tagsAdicionadas: ["VIP"] });
    expect(createLeadHandler).toHaveBeenCalledTimes(1);
    expect(moveLeadHandler).not.toHaveBeenCalled();
  });

  it("dois negócios abertos no mesmo Kanban: não adivinha qual mover", async () => {
    const db = base();
    db.tabelas.crm_leads!.push(
      { id: "l-1", organization_id: ORG, contact_id: "c-1", pipeline_id: VENDAS, stage_id: "s-novo", status: "open" },
      { id: "l-2", organization_id: ORG, contact_id: "c-1", pipeline_id: VENDAS, stage_id: "s-novo", status: "open" },
    );
    const r = await aplicarTagsNoKanban(db.client, CTX, { contactId: "c-1", tagsAdicionadas: ["VIP"] });
    expect(moveLeadHandler).not.toHaveBeenCalled();
    expect(createLeadHandler).not.toHaveBeenCalled();
    expect(r[0]).toMatchObject({ acao: "ambiguo" });
  });

  it("isolamento: a tag 'VIP' de OUTRA organização, ligada a outra coluna, não move ninguém de lá", async () => {
    const db = base();
    const r = await aplicarTagsNoKanban(db.client, CTX, { contactId: "c-1", tagsAdicionadas: ["VIP"] });
    expect(r.map((e) => e.pipeline_id)).toEqual([VENDAS]);
    expect(createLeadHandler.mock.calls.every((c) => (c[2] as { stage_id: string }).stage_id !== "s-alheia")).toBe(true);
  });

  it("tag arquivada não leva a lugar nenhum", async () => {
    const db = base();
    const r = await aplicarTagsNoKanban(db.client, CTX, { contactId: "c-1", tagsAdicionadas: ["Antiga"] });
    expect(r).toEqual([]);
  });

  it("duas tags do lote em colunas diferentes do MESMO Kanban: vale a última aplicada", async () => {
    const db = base();
    const r = await aplicarTagsNoKanban(db.client, CTX, {
      contactId: "c-1",
      tagsAdicionadas: ["VIP", "Orçamento"],
    });
    expect(createLeadHandler).toHaveBeenCalledTimes(1);
    expect(createLeadHandler.mock.calls[0]![2]).toMatchObject({ stage_id: "s-orc" });
    expect(r).toHaveLength(1);
  });

  it("contato anonimizado (LGPD) nunca ganha card", async () => {
    const db = base();
    db.tabelas.contacts![0]!.is_anonymized = true;
    const r = await aplicarTagsNoKanban(db.client, CTX, { contactId: "c-1", tagsAdicionadas: ["VIP"] });
    expect(r).toEqual([]);
    expect(createLeadHandler).not.toHaveBeenCalled();
  });

  it("falha de um Kanban vira efeito 'falhou' e não derruba a aplicação da tag", async () => {
    const db = base();
    createLeadHandler.mockRejectedValueOnce(new Error("banco caiu"));
    const r = await aplicarTagsNoKanban(db.client, CTX, { contactId: "c-1", tagsAdicionadas: ["VIP"] });
    expect(r[0]).toMatchObject({ acao: "falhou" });
  });
});

describe("aplicarTagDaColuna — o card entra na coluna e o contato ganha a tag", () => {
  function comLead() {
    const db = base();
    db.tabelas.crm_leads!.push({ id: "l-1", organization_id: ORG, contact_id: "c-1", pipeline_id: VENDAS, stage_id: "s-proposta", status: "open" });
    return db;
  }

  it("acrescenta as tags ATIVAS da coluna ao contato e emite contact.tag_added", async () => {
    const db = comLead();
    const r = await aplicarTagDaColuna(db.client, CTX, { leadId: "l-1", stageId: "s-proposta" });
    expect(r.tagsAcrescentadas).toEqual(["VIP"]);
    expect(db.tabelas.contacts![0]!.tags).toEqual(["VIP"]);
    expect(db.rpcs.find((c) => c.nome === "emit_event")?.args).toMatchObject({
      p_event_type: "contact.tag_added",
      p_payload: expect.objectContaining({ added_tags: ["VIP"] }),
    });
  });

  it("nunca remove nem duplica: tag que o contato já tinha fica como estava", async () => {
    const db = comLead();
    db.tabelas.contacts![0]!.tags = ["VIP", "Outra"];
    const r = await aplicarTagDaColuna(db.client, CTX, { leadId: "l-1", stageId: "s-proposta" });
    expect(r.tagsAcrescentadas).toEqual([]);
    expect(db.escritas.filter((e) => e.tabela === "contacts")).toEqual([]);
  });

  it("o salto para OUTROS Kanbans existe, mas nunca volta para o Kanban de onde a tag veio", async () => {
    const db = comLead();
    db.tabelas.crm_stage_tags!.push({ organization_id: ORG, pipeline_id: SUPORTE, stage_id: "s-sup-vip", tag_id: "t-vip" });
    const r = await aplicarTagDaColuna(db.client, CTX, { leadId: "l-1", stageId: "s-proposta" });
    expect(r.efeitos.map((e) => e.pipeline_id)).toEqual([SUPORTE]);
    expect(createLeadHandler.mock.calls[0]![2]).toMatchObject({ pipeline_id: SUPORTE, stage_id: "s-sup-vip" });
    expect(moveLeadHandler).not.toHaveBeenCalled();
  });

  it("coluna sem tag: nada acontece", async () => {
    const db = comLead();
    const r = await aplicarTagDaColuna(db.client, CTX, { leadId: "l-1", stageId: "s-novo" });
    expect(r).toEqual({ tagsAcrescentadas: [], efeitos: [] });
    expect(db.escritas).toEqual([]);
  });
});
