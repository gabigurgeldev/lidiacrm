/**
 * A mensagem de recusa aponta para a causa CERTA.
 *
 * O caso medido: um pedido de 3153 caracteres recebeu "Descreva o que você quer
 * antes de continuar." — com o texto na tela. Quem leu entendeu "a IA não
 * entendeu meu pedido" e reescreveu o pedido três vezes, que é o conserto que a
 * frase pedia e não o que o problema exigia.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { MAX_CARACTERES_DO_PEDIDO, motivoDaEntradaRecusada } from "./entrada";

const schema = z.strictObject({
  pedido: z.string().trim().min(1).max(MAX_CARACTERES_DO_PEDIDO),
  historico: z.array(z.strictObject({ texto: z.string() })).max(20).default([]),
});

function recusar(corpo: unknown): string {
  const lido = schema.safeParse(corpo);
  expect(lido.success, "o corpo deveria ter sido recusado").toBe(false);
  return motivoDaEntradaRecusada(lido.error!, corpo);
}

describe("motivo da recusa", () => {
  it("texto grande demais diz o tamanho e o limite", () => {
    const pedido = "a".repeat(3153);
    const frase = recusar({ pedido });

    expect(frase).toContain("3153");
    expect(frase).toContain(String(MAX_CARACTERES_DO_PEDIDO));
    expect(
      frase,
      "a frase de campo vazio não pode servir para texto grande demais — " +
        "ela manda a pessoa consertar a coisa errada",
    ).not.toContain("Descreva o que você quer");
  });

  it("campo vazio continua com a frase de campo vazio", () => {
    expect(recusar({ pedido: "   " })).toContain("Descreva o que você quer");
  });

  it("corpo sem o campo nenhum também", () => {
    expect(recusar({})).toContain("Descreva o que você quer");
  });

  it("conversa longa demais tem frase própria — o conserto dela é outro", () => {
    const frase = recusar({
      pedido: "monta um fluxo",
      historico: Array.from({ length: 21 }, () => ({ texto: "oi" })),
    });

    expect(frase).toContain("conversa");
    expect(frase).not.toContain("Descreva o que você quer");
  });
});
