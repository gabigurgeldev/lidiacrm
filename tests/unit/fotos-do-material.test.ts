import { describe, expect, it, vi } from "vitest";

import {
  ERRO_DE_CAMINHO_DA_FOTO,
  ERRO_DE_FORMATO_DA_FOTO,
  resolverFotoDoAgente,
} from "@/lib/agent-engine/agent/fotos-do-material";
import type { Queryable } from "@/lib/agent-engine/queue/queue";
import { apelidoDaFoto } from "@/lib/ai/rag/apelido-da-foto";

/**
 * De "foto-1a2b3c4d" ao arquivo: as conferências que impedem o agente de mandar
 * ao cliente uma foto que não é dele, de outra organização, arquivada, ou um
 * arquivo qualquer do bucket com um `blob_path` trocado.
 *
 * O dublê de banco APLICA os filtros que a consulta declara — e o primeiro caso
 * confere que a consulta os declara mesmo. Sem isso, o dublê filtraria por
 * conta própria e o teste passaria com o código sem filtro nenhum.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const OUTRA = "99999999-9999-4999-8999-999999999999";
const F1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const F2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ARQ = "0f0e0d0c-0b0a-4908-8706-050403020100";

interface Fonte {
  id: string;
  organization_id: string;
  source_type: string;
  is_active: boolean;
  status: string;
  name: string | null;
  source_metadata: Record<string, unknown>;
  last_index_error?: string | null;
}

function foto(over: Partial<Fonte> = {}): Fonte {
  return {
    id: F1,
    organization_id: ORG,
    source_type: "imagem",
    is_active: true,
    status: "ready",
    name: "Vestido Areia",
    source_metadata: {
      blob_path: `${ORG}/materiais/${ARQ}.jpg`,
      mime_type: "image/jpeg",
      size_bytes: 1234,
      filename: "areia.jpg",
      descricao: "Vestido na cor areia",
    },
    ...over,
  };
}

function fakeDb(tabela: Fonte[]) {
  const sqls: string[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    sqls.push(sql);
    if (/^\s*select/i.test(sql)) {
      const [org, ids] = params as [string, string[]];
      const rows = tabela.filter(
        (f) =>
          f.organization_id === org &&
          ids.includes(f.id) &&
          f.source_type === "imagem" &&
          f.is_active &&
          f.status !== "archived",
      );
      return { rows: rows.map((f) => ({ id: f.id, name: f.name, source_metadata: f.source_metadata })) };
    }
    if (/^\s*update/i.test(sql)) {
      const [org, id, erro] = params as [string, string, string];
      for (const f of tabela) if (f.organization_id === org && f.id === id) f.last_index_error = erro;
      return { rows: [] };
    }
    throw new Error(`dublê: sql inesperado ${sql}`);
  });
  return { db: { query } as unknown as Queryable, sqls, query };
}

describe("resolverFotoDoAgente", () => {
  it("a consulta declara os filtros que o dublê aplica (guarda de vacuidade)", async () => {
    const { db, sqls } = fakeDb([foto()]);
    await resolverFotoDoAgente(db, { tenantId: ORG, knowledgeSourceIds: [F1], foto: apelidoDaFoto(F1) });
    const sql = sqls[0]!;
    expect(sql).toMatch(/organization_id = \$1/);
    expect(sql).toMatch(/id = any\(\$2::uuid\[\]\)/);
    expect(sql).toMatch(/source_type = 'imagem'/);
    expect(sql).toMatch(/is_active/);
    expect(sql).toMatch(/status <> 'archived'/);
  });

  it("⭐ resolve o apelido na foto do agente, com caminho, formato e nome", async () => {
    const { db } = fakeDb([foto()]);
    const r = await resolverFotoDoAgente(db, { tenantId: ORG, knowledgeSourceIds: [F1], foto: apelidoDaFoto(F1) });
    expect(r).toEqual({
      ok: true,
      foto: { materialId: F1, path: `${ORG}/materiais/${ARQ}.jpg`, mime: "image/jpeg", nome: "Vestido Areia" },
    });
  });

  it("sem nome, usa o nome do arquivo", async () => {
    const { db } = fakeDb([foto({ name: "  " })]);
    const r = await resolverFotoDoAgente(db, { tenantId: ORG, knowledgeSourceIds: [F1], foto: apelidoDaFoto(F1) });
    expect(r.ok && r.foto.nome).toBe("areia.jpg");
  });

  it("⭐ foto de OUTRA organização é desconhecida, mesmo com o id na lista", async () => {
    const { db } = fakeDb([foto({ organization_id: OUTRA })]);
    const r = await resolverFotoDoAgente(db, { tenantId: ORG, knowledgeSourceIds: [F1], foto: apelidoDaFoto(F1) });
    expect(r).toMatchObject({ ok: false, code: "foto_desconhecida" });
  });

  it("⭐ foto fora da lista de materiais do agente é desconhecida", async () => {
    const { db } = fakeDb([foto(), foto({ id: F2 })]);
    const r = await resolverFotoDoAgente(db, { tenantId: ORG, knowledgeSourceIds: [F1], foto: apelidoDaFoto(F2) });
    expect(r).toMatchObject({ ok: false, code: "foto_desconhecida" });
  });

  it("foto arquivada ou desativada é desconhecida", async () => {
    for (const over of [{ status: "archived" }, { is_active: false }]) {
      const { db } = fakeDb([foto(over)]);
      const r = await resolverFotoDoAgente(db, { tenantId: ORG, knowledgeSourceIds: [F1], foto: apelidoDaFoto(F1) });
      expect(r).toMatchObject({ ok: false, code: "foto_desconhecida" });
    }
  });

  it("apelido inventado é desconhecido, e a mensagem ensina a não inventar", async () => {
    const { db } = fakeDb([foto()]);
    const r = await resolverFotoDoAgente(db, { tenantId: ORG, knowledgeSourceIds: [F1], foto: "foto-00000000" });
    expect(r).toMatchObject({ ok: false, code: "foto_desconhecida" });
    expect(!r.ok && r.message).toMatch(/nunca invente/);
  });

  it("agente sem material nenhum nem consulta o banco", async () => {
    const { db, query } = fakeDb([foto()]);
    const r = await resolverFotoDoAgente(db, { tenantId: ORG, knowledgeSourceIds: [], foto: apelidoDaFoto(F1) });
    expect(r).toMatchObject({ ok: false, code: "foto_desconhecida" });
    expect(query).not.toHaveBeenCalled();
  });

  it("⭐ caminho ADULTERADO (outra org) é indisponível e grava o motivo na fonte", async () => {
    const tabela = [
      foto({ source_metadata: { blob_path: `${OUTRA}/materiais/${ARQ}.jpg`, mime_type: "image/jpeg" } }),
    ];
    const { db } = fakeDb(tabela);
    const r = await resolverFotoDoAgente(db, { tenantId: ORG, knowledgeSourceIds: [F1], foto: apelidoDaFoto(F1) });
    expect(r).toMatchObject({ ok: false, code: "foto_indisponivel" });
    // O laço de retorno: o card do material mostra por que a foto parou de sair.
    expect(tabela[0]!.last_index_error).toBe(ERRO_DE_CAMINHO_DA_FOTO);
  });

  it("caminho de conversa (fora de materiais/) também é indisponível", async () => {
    const tabela = [foto({ source_metadata: { blob_path: `${ORG}/conversa/x.jpg`, mime_type: "image/jpeg" } })];
    const { db } = fakeDb(tabela);
    const r = await resolverFotoDoAgente(db, { tenantId: ORG, knowledgeSourceIds: [F1], foto: apelidoDaFoto(F1) });
    expect(r).toMatchObject({ ok: false, code: "foto_indisponivel" });
    expect(tabela[0]!.last_index_error).toBe(ERRO_DE_CAMINHO_DA_FOTO);
  });

  it("formato que não é de foto é indisponível e grava o motivo", async () => {
    const tabela = [
      foto({ source_metadata: { blob_path: `${ORG}/materiais/${ARQ}.jpg`, mime_type: "text/html" } }),
    ];
    const { db } = fakeDb(tabela);
    const r = await resolverFotoDoAgente(db, { tenantId: ORG, knowledgeSourceIds: [F1], foto: apelidoDaFoto(F1) });
    expect(r).toMatchObject({ ok: false, code: "foto_indisponivel" });
    expect(tabela[0]!.last_index_error).toBe(ERRO_DE_FORMATO_DA_FOTO);
  });

  it("⭐ apelido AMBÍGUO (duas fotos casam) não escolhe uma", async () => {
    // Colisão forçada: o dublê devolve duas linhas com o MESMO id — a única
    // forma de duas linhas terem o mesmo apelido sem procurar uma colisão real.
    const { db } = fakeDb([foto(), foto({ name: "Outra" })]);
    const r = await resolverFotoDoAgente(db, { tenantId: ORG, knowledgeSourceIds: [F1], foto: apelidoDaFoto(F1) });
    expect(r).toMatchObject({ ok: false, code: "foto_indisponivel" });
  });

  it("falha ao gravar o motivo não derruba o envio recusado", async () => {
    const query = vi.fn(async (sql: string) => {
      if (/^\s*select/i.test(sql)) {
        return {
          rows: [{ id: F1, name: "x", source_metadata: { blob_path: "../segredo", mime_type: "image/jpeg" } }],
        };
      }
      throw new Error("banco fora");
    });
    const r = await resolverFotoDoAgente({ query } as unknown as Queryable, {
      tenantId: ORG,
      knowledgeSourceIds: [F1],
      foto: apelidoDaFoto(F1),
    });
    expect(r).toMatchObject({ ok: false, code: "foto_indisponivel" });
  });
});
