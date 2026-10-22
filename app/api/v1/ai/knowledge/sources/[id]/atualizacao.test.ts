import { describe, expect, it } from "vitest";

import { montarAtualizacao, patchSourceSchema } from "./atualizacao";

/**
 * PATCH de material: para FOTO, a descrição entra mesclada sobre o metadata do
 * banco, e o metadata do corpo é recusado. É o que impede um PATCH de trocar o
 * arquivo que o agente manda aos clientes por qualquer outro do bucket.
 */

const ORG = "22222222-2222-4222-8222-222222222222";
const META_DA_FOTO = {
  blob_path: `${ORG}/materiais/44444444-4444-4444-8444-444444444444.jpg`,
  mime_type: "image/jpeg",
  size_bytes: 1234,
  filename: "rosa.jpg",
  descricao: "Buquê de rosas vermelhas",
  uploaded_by: "11111111-1111-4111-8111-111111111111",
};

const parse = (corpo: unknown) => patchSourceSchema.parse(corpo);

describe("montarAtualizacao — foto", () => {
  it("descrição nova é mesclada e blob_path/mime_type ficam os do banco", () => {
    const r = montarAtualizacao(parse({ descricao: "  Buquê de rosas brancas  " }), {
      tipo: "imagem",
      source_metadata: META_DA_FOTO,
    });
    expect(r).toEqual({
      ok: true,
      campos: { source_metadata: { ...META_DA_FOTO, descricao: "Buquê de rosas brancas" } },
    });
  });

  it("source_metadata no corpo é RECUSADO — não há como trocar blob_path por aqui", () => {
    const r = montarAtualizacao(
      parse({ source_metadata: { blob_path: "outra-org/conversa/arquivo.jpg" } }),
      { tipo: "imagem", source_metadata: META_DA_FOTO },
    );
    expect(r.ok).toBe(false);
  });

  it("nem junto com a descrição o metadata do corpo passa", () => {
    const r = montarAtualizacao(
      parse({ descricao: "nova", source_metadata: { ...META_DA_FOTO, blob_path: "x/y.jpg" } }),
      { tipo: "imagem", source_metadata: META_DA_FOTO },
    );
    expect(r.ok).toBe(false);
  });

  it("só o nome: não toca no metadata", () => {
    const r = montarAtualizacao(parse({ name: "Rosas" }), {
      tipo: "imagem",
      source_metadata: META_DA_FOTO,
    });
    expect(r).toEqual({ ok: true, campos: { name: "Rosas" } });
  });

  it("descrição curta demais é recusada pelo schema", () => {
    expect(patchSourceSchema.safeParse({ descricao: " a " }).success).toBe(false);
  });
});

describe("montarAtualizacao — outros tipos", () => {
  it("descrição para material que não é foto → recusa (não descarta em silêncio)", () => {
    const r = montarAtualizacao(parse({ descricao: "texto qualquer" }), {
      tipo: "documento",
      source_metadata: {},
    });
    expect(r.ok).toBe(false);
  });

  it("source_metadata de documento continua editável como antes", () => {
    const r = montarAtualizacao(parse({ source_metadata: { origem: "manual" } }), {
      tipo: "documento",
      source_metadata: {},
    });
    expect(r).toEqual({ ok: true, campos: { source_metadata: { origem: "manual" } } });
  });
});
