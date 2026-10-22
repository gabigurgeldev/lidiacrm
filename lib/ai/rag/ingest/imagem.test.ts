import { describe, expect, it } from "vitest";

import { apelidoDaFoto } from "@/lib/ai/rag/apelido-da-foto";
import { ErroDeExtracao } from "@/lib/ai/rag/ingest/documento";

import { pedacosDeImagem } from "./imagem";

/**
 * O trecho de uma foto: UM só, com nome e descrição, o APELIDO na metadata e
 * nada do bucket. Sem descrição, a fonte é recusada com o mesmo erro de
 * extração dos documentos — é ele que aparece no card do material.
 */

const ID = "33333333-3333-4333-8333-333333333333";
const ORG = "22222222-2222-4222-8222-222222222222";

const fonte = (source_metadata: Record<string, unknown> | null) => ({
  id: ID,
  name: "Buquê de rosas",
  source_metadata,
});

describe("pedacosDeImagem", () => {
  it("gera UM trecho com nome + descrição e o apelido da foto", () => {
    const pedacos = pedacosDeImagem(
      fonte({
        blob_path: `${ORG}/materiais/44444444-4444-4444-8444-444444444444.jpg`,
        mime_type: "image/jpeg",
        descricao: "  12 rosas vermelhas com laço dourado  ",
      }),
    );

    expect(pedacos).toHaveLength(1);
    expect(pedacos[0]!.content).toBe("Foto: Buquê de rosas\n12 rosas vermelhas com laço dourado");
    expect(pedacos[0]!.metadata).toEqual({ source_type: "imagem", foto: apelidoDaFoto(ID) });
  });

  it("NUNCA leva o caminho do bucket (nem no conteúdo, nem na metadata)", () => {
    const caminho = `${ORG}/materiais/44444444-4444-4444-8444-444444444444.jpg`;
    const [p] = pedacosDeImagem(fonte({ blob_path: caminho, descricao: "Cartela de cores" }));

    expect(JSON.stringify(p!.metadata)).not.toContain("materiais");
    expect(p!.metadata).not.toHaveProperty("blob_path");
    expect(p!.content).not.toContain(caminho);
  });

  it.each([
    ["sem descrição", { blob_path: "x" }],
    ["descrição em branco", { descricao: "   " }],
    ["descrição que não é texto", { descricao: 42 }],
    ["sem metadata", null],
  ])("%s → ErroDeExtracao com motivo legível", (_rotulo, meta) => {
    expect(() => pedacosDeImagem(fonte(meta))).toThrow(ErroDeExtracao);
    expect(() => pedacosDeImagem(fonte(meta))).toThrow(/descrição/);
  });
});
