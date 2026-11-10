import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { INSTRUCAO_DE_DESCRICAO_DA_IMAGEM } from "@/lib/messaging/media/instrucao-da-imagem";

/**
 * A descrição da foto é tudo o que o agente sabe da imagem depois do turno em
 * que ela chegou. Estes casos prendem o que a descrição TEM de pedir — e que a
 * versão de "1-2 frases" não pedia: o tamanho estimado por uma referência
 * visível (o comprimento do cabelo que o agente do salão nunca recebia).
 */
describe("instrução de descrição da imagem do cliente", () => {
  const texto = INSTRUCAO_DE_DESCRICAO_DA_IMAGEM.toLowerCase();

  it("pede tamanho estimado por uma referência visível", () => {
    expect(texto).toContain("comprimento estimado");
    expect(texto).toContain("referência");
    expect(texto).toContain("ombro");
  });

  it("pede os detalhes que mudam um orçamento", () => {
    for (const termo of ["cores", "quantidade", "estado de conservação", "marca", "medidas"]) {
      expect(texto).toContain(termo);
    }
  });

  it("pede para dizer o que a imagem é — print e quadro de vídeo inclusive", () => {
    expect(texto).toContain("print de tela");
    expect(texto).toContain("quadro de vídeo");
  });

  it("dá espaço para os detalhes sem virar redação", () => {
    expect(texto).toContain("até 4 frases");
    expect(texto).not.toContain("1-2 frases");
  });

  it("proíbe inventar o que não aparece", () => {
    expect(texto).toContain("não invente");
  });

  it("é o texto que o worker de mídia manda ao modelo de visão", () => {
    const fonte = fs.readFileSync(path.join(process.cwd(), "workers/media-derive-worker.ts"), "utf8");
    expect(fonte).toContain("text: INSTRUCAO_DE_DESCRICAO_DA_IMAGEM");
    expect(fonte).not.toContain("Descreva objetivamente esta imagem");
  });
});
