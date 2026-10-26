import { beforeEach, describe, expect, it, vi } from "vitest";

const audit = vi.fn();
vi.mock("@/lib/audit", () => ({ audit: (...a: unknown[]) => audit(...a) }));

import { ApiError } from "@/lib/api/types";
import {
  atualizarTag,
  criarTag,
  definirColunasDaTag,
  definirTagsDaColuna,
  listarTags,
} from "@/lib/tags/operacoes";
import { bancoEmMemoria } from "@/tests/helpers/banco-em-memoria";

/**
 * O catálogo de tags (migration 0248): criar sem duplicata por caixa, renomear
 * pedindo confirmação antes de FUNDIR, e uma tag em no máximo uma coluna por
 * Kanban. Cada recusa precisa sair com o código que a tela usa para perguntar.
 */

const ORG = "org-1";
const OUTRA = "org-2";

function db() {
  return bancoEmMemoria({
    crm_tags: [
      { id: "t-vip", organization_id: ORG, name: "VIP", color: "#2563eb", description: null, is_archived: false, created_at: "1" },
      { id: "t-novo", organization_id: ORG, name: "Novo", color: "#16a34a", description: null, is_archived: false, created_at: "2" },
      { id: "t-alheia", organization_id: OUTRA, name: "Alheia", color: "#dc2626", description: null, is_archived: false, created_at: "3" },
    ],
    crm_stage_tags: [{ organization_id: ORG, pipeline_id: "p-1", stage_id: "s-a", tag_id: "t-vip" }],
    crm_stages: [
      { id: "s-a", organization_id: ORG, pipeline_id: "p-1", name: "A", is_archived: false },
      { id: "s-b", organization_id: ORG, pipeline_id: "p-1", name: "B", is_archived: false },
      { id: "s-outro", organization_id: ORG, pipeline_id: "p-2", name: "Outro", is_archived: false },
    ],
    crm_pipelines: [
      { id: "p-1", organization_id: ORG, name: "Vendas", is_archived: false },
      { id: "p-2", organization_id: ORG, name: "Pós", is_archived: false },
    ],
    contacts: [
      { id: "c-1", organization_id: ORG, tags: ["VIP"] },
      { id: "c-2", organization_id: ORG, tags: ["VIP", "Novo"] },
      { id: "c-3", organization_id: OUTRA, tags: ["VIP"] },
    ],
  });
}

function deps(b: ReturnType<typeof db>) {
  return { supabase: b.client, admin: b.client, organizationId: ORG, userId: "u-1", requestId: "req" };
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

beforeEach(() => audit.mockReset());

describe("listarTags", () => {
  it("só a organização ativa, com a coluna vinculada e a contagem de contatos dela", async () => {
    const b = db();
    const tags = await listarTags(b.client, ORG, { comUso: true });
    expect(tags.map((t) => t.name)).toEqual(["Novo", "VIP"]);
    const vip = tags.find((t) => t.name === "VIP")!;
    expect(vip.uso).toBe(2); // c-3 é de outra organização
    expect(vip.colunas).toEqual([{ pipeline_id: "p-1", pipeline_name: "Vendas", stage_id: "s-a", stage_name: "A" }]);
  });
});

describe("criarTag", () => {
  it("recusa duplicata ignorando a caixa: 'vip' quando já existe 'VIP'", async () => {
    const b = db();
    const e = await recusa(criarTag(deps(b), { name: "vip" }));
    expect(e.status).toBe(409);
    expect(e.code).toBe("tag_already_exists");
    expect(e.message).toContain("VIP");
    expect(b.escritas).toEqual([]);
  });

  it("apara o nome, grava na organização da sessão e audita", async () => {
    const b = db();
    const tag = await criarTag(deps(b), { name: "  Pós   venda ", color: "#DB2777" });
    expect(tag).toMatchObject({ name: "Pós venda", color: "#db2777", colunas: [] });
    expect(b.escritas[0]!.valores).toEqual([expect.objectContaining({ organization_id: ORG, name: "Pós venda" })]);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "tag.created", organizationId: ORG }));
  });

  it("recusa cor fora de #rrggbb", async () => {
    const e = await recusa(criarTag(deps(db()), { name: "X", color: "red" }));
    expect(e.status).toBe(422);
  });

  it("a mesma tag pode existir em OUTRA organização", async () => {
    const b = db();
    await expect(criarTag(deps(b), { name: "Alheia" })).resolves.toMatchObject({ name: "Alheia" });
  });
});

describe("atualizarTag", () => {
  it("renomear para o nome de outra tag pede confirmação antes de fundir — e não toca nada", async () => {
    const b = db();
    const e = await recusa(atualizarTag(deps(b), "t-novo", { name: "VIP" }));
    expect(e.code).toBe("tag_merge_required");
    expect(b.rpcs).toEqual([]);
  });

  it("com `fundir`, chama fn_renomear_tag com a organização da SESSÃO", async () => {
    const b = db();
    b.respostasDeRpc.fn_renomear_tag = () => ({ data: "t-vip", error: null });
    const r = await atualizarTag(deps(b), "t-novo", { name: "VIP", fundir: true });
    expect(r).toEqual({ id: "t-vip", fundida_em: "t-vip" });
    expect(b.rpcs[0]).toEqual({
      nome: "fn_renomear_tag",
      args: { p_organization_id: ORG, p_tag_id: "t-novo", p_novo_nome: "VIP" },
    });
  });

  it("mesmo nome com outra caixa não funde: pede o nome exato", async () => {
    const e = await recusa(atualizarTag(deps(db()), "t-novo", { name: "vip", fundir: true }));
    expect(e.code).toBe("tag_already_exists");
  });

  it("tag de outra organização é 404, não 403 (não confirma que existe)", async () => {
    const e = await recusa(atualizarTag(deps(db()), "t-alheia", { color: "#000000" }));
    expect(e.status).toBe(404);
  });

  it("arquivar só marca a tag — os contatos continuam com ela", async () => {
    const b = db();
    await atualizarTag(deps(b), "t-vip", { is_archived: true });
    expect(b.tabelas.crm_tags!.find((t) => t.id === "t-vip")!.is_archived).toBe(true);
    expect(b.tabelas.contacts!.find((c) => c.id === "c-1")!.tags).toEqual(["VIP"]);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "tag.archived" }));
  });
});

describe("definirTagsDaColuna", () => {
  it("tag já em OUTRA coluna do mesmo Kanban: 409 com o conflito", async () => {
    const b = db();
    const e = await recusa(definirTagsDaColuna(deps(b), "p-1", "s-b", { tag_ids: ["t-vip"] }));
    expect(e.code).toBe("tag_already_linked_in_pipeline");
    expect(b.escritas).toEqual([]);
  });

  it("`mover: true` tira da coluna antiga e põe nesta", async () => {
    const b = db();
    await definirTagsDaColuna(deps(b), "p-1", "s-b", { tag_ids: ["t-vip"], mover: true });
    expect(b.tabelas.crm_stage_tags!.filter((l) => l.tag_id === "t-vip").map((l) => l.stage_id)).toEqual(["s-b"]);
  });

  it("a mesma tag pode estar em colunas de Kanbans DIFERENTES", async () => {
    const b = db();
    await definirTagsDaColuna(deps(b), "p-2", "s-outro", { tag_ids: ["t-vip"] });
    expect(b.tabelas.crm_stage_tags!.filter((l) => l.tag_id === "t-vip")).toHaveLength(2);
  });

  it("coluna que não é deste Kanban: 404", async () => {
    const e = await recusa(definirTagsDaColuna(deps(db()), "p-1", "s-outro", { tag_ids: [] }));
    expect(e.status).toBe(404);
  });

  it("tag de outra organização: 404, sem gravar vínculo", async () => {
    const b = db();
    const e = await recusa(definirTagsDaColuna(deps(b), "p-1", "s-b", { tag_ids: ["t-alheia"] }));
    expect(e.status).toBe(404);
    expect(b.escritas).toEqual([]);
  });

  it("lista vazia desvincula tudo da coluna", async () => {
    const b = db();
    await definirTagsDaColuna(deps(b), "p-1", "s-a", { tag_ids: [] });
    expect(b.tabelas.crm_stage_tags).toEqual([]);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "stage.tags_changed" }));
  });
});

describe("definirColunasDaTag (pela página de Tags)", () => {
  it("troca as colunas da tag — e só dela", async () => {
    const b = db();
    b.tabelas.crm_stage_tags!.push({ organization_id: ORG, pipeline_id: "p-1", stage_id: "s-a", tag_id: "t-novo" });
    await definirColunasDaTag(deps(b), "t-vip", { stage_ids: ["s-b", "s-outro"] });
    const vip = b.tabelas.crm_stage_tags!.filter((l) => l.tag_id === "t-vip").map((l) => l.stage_id).sort();
    expect(vip).toEqual(["s-b", "s-outro"]);
    expect(b.tabelas.crm_stage_tags!.filter((l) => l.tag_id === "t-novo")).toHaveLength(1);
  });

  it("duas colunas do MESMO Kanban: 422, sem apagar o que havia", async () => {
    const b = db();
    const e = await recusa(definirColunasDaTag(deps(b), "t-vip", { stage_ids: ["s-a", "s-b"] }));
    expect(e.code).toBe("one_column_per_pipeline");
    expect(b.escritas).toEqual([]);
  });

  it("tag de outra organização: 404", async () => {
    const e = await recusa(definirColunasDaTag(deps(db()), "t-alheia", { stage_ids: [] }));
    expect(e.status).toBe(404);
  });
});
