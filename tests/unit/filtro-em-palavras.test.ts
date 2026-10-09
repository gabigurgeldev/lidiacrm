/**
 * A tela mostra "Só responder sobre…" como lista de palavras; o banco guarda um
 * padrão. Ida e volta não podem perder nada, e padrão que não é lista não pode
 * ser reescrito pela tela.
 *
 * Sabotagens medidas:
 *  - tirar `escapar` de `palavrasParaPadrao` ⇒ "caractere especial" vermelho;
 *  - aceitar `\b` como letra em `padraoParaPalavras` ⇒ "não é lista" vermelho.
 */
import { describe, expect, it } from "vitest";

import { padraoParaPalavras, palavrasParaPadrao } from "@/lib/ai/agents/filtro-em-palavras";
import { problemaDoPadrao } from "@/lib/regex/segura";

describe("palavras ⇄ padrão", () => {
  it("lista por vírgula vira alternação, sem repetidas nem vazias", () => {
    expect(palavrasParaPadrao("pedido, entrega , , Pedido,  segunda   via")).toBe("pedido|entrega|segunda via");
    expect(palavrasParaPadrao(" , ")).toBeNull();
  });

  it("caractere especial vira literal (R$ 10 não é regex)", () => {
    const p = palavrasParaPadrao("R$ 10, 2.0, (urgente)")!;
    expect(problemaDoPadrao(p)).toBeNull();
    const re = new RegExp(p, "i");
    expect(re.test("custa R$ 10?")).toBe(true);
    expect(re.test("versao 2x0")).toBe(false);
    expect(re.test("e (urgente)")).toBe(true);
  });

  it("ida e volta preserva as palavras", () => {
    const texto = "pedido, R$ 10, segunda via, c++";
    expect(padraoParaPalavras(palavrasParaPadrao(texto))!.join(", ")).toBe(texto);
  });

  it("padrão antigo da tela, com barra vertical, abre como palavras", () => {
    expect(padraoParaPalavras("pedido|status|orçamento")).toEqual(["pedido", "status", "orçamento"]);
    expect(padraoParaPalavras("(?:pedido|status)")).toEqual(["pedido", "status"]);
    expect(padraoParaPalavras(null)).toEqual([]);
  });

  it("o que não é lista de palavras fica no modo avançado", () => {
    expect(padraoParaPalavras("\\bpedido\\b")).toBeNull();
    expect(padraoParaPalavras("boleto.*vencido")).toBeNull();
    expect(padraoParaPalavras("pedidos?")).toBeNull();
    expect(padraoParaPalavras("a||b")).toBeNull();
  });
});
