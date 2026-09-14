/**
 * A pergunta "tem o marcador X" — e o defeito de lógica que ela fecha.
 *
 * O caso que dá nome ao arquivo é o último: num fluxo SEM LEAD (o de quem
 * chegou pelo WhatsApp), "não tem o marcador" precisa responder VERDADE. Escrito
 * com `not_contains` ele responde FALSO — porque campo ausente é falso para todo
 * operador — e o fluxo segue para sempre pelo lado errado, sem erro nenhum.
 */
import { describe, expect, it } from "vitest";

import { avaliarGrupo, type Grupo } from "./condicoes";
import { lerMarcador, montarMarcador } from "./regra-de-marcador";

const escopo = (lead: string[] | null, contact: string[] | null) => ({
  lead: lead === null ? null : { tags: lead },
  contact: contact === null ? null : { tags: contact },
});

describe("montar e ler são inversos", () => {
  it("⭐ ida e volta preserva marcador e sentido", () => {
    for (const tem of [true, false]) {
      const grupo = montarMarcador({ tag: "vip", tem });
      expect(lerMarcador(grupo)).toEqual({ tag: "vip", tem });
    }
  });

  it("marcador ainda em branco continua sendo a pergunta de marcador", () => {
    // Senão a tela voltaria sozinha ao editor de campo cru assim que a pessoa
    // trocasse o modo, antes de digitar a primeira letra.
    expect(lerMarcador(montarMarcador({ tag: "", tem: true }))).toEqual({ tag: "", tem: true });
  });

  it("o que NÃO é a forma exata devolve null, e a tela cai no editor cru", () => {
    expect(lerMarcador({ campo: "lead.tags", op: "contains", valor: "vip" })).toBeNull();
    expect(
      lerMarcador({
        combinador: "and",
        itens: [
          { campo: "lead.tags", op: "contains", valor: "vip" },
          { campo: "contact.tags", op: "contains", valor: "vip" },
        ],
      }),
    ).toBeNull();
    // Dois marcadores diferentes nos dois campos: parecido, e outra pergunta.
    expect(
      lerMarcador({
        combinador: "or",
        itens: [
          { campo: "lead.tags", op: "contains", valor: "vip" },
          { campo: "contact.tags", op: "contains", valor: "ouro" },
        ],
      }),
    ).toBeNull();
  });
});

describe("a pergunta responde certo nos dois mundos", () => {
  const tem = montarMarcador({ tag: "vip", tem: true });
  const naoTem = montarMarcador({ tag: "vip", tem: false });

  it("⭐ marcado no LEAD", () => {
    expect(avaliarGrupo(tem, escopo(["vip"], []))).toBe(true);
    expect(avaliarGrupo(naoTem, escopo(["vip"], []))).toBe(false);
  });

  it("⭐ marcado no CONTATO, sem lead — o fluxo de quem chegou pelo WhatsApp", () => {
    expect(avaliarGrupo(tem, escopo(null, ["vip"]))).toBe(true);
    expect(avaliarGrupo(naoTem, escopo(null, ["vip"]))).toBe(false);
  });

  it("⭐ SEM LEAD e sem o marcador: 'não tem' é VERDADE", () => {
    // O defeito inteiro. Com `not_contains` em `lead.tags` isto daria falso, e a
    // saída "não está marcado" nunca seria escolhida para quem não está marcado.
    expect(avaliarGrupo(naoTem, escopo(null, ["outro"]))).toBe(true);
    expect(avaliarGrupo(tem, escopo(null, ["outro"]))).toBe(false);
  });

  it("marcador que parece número compara como texto", () => {
    const grupo: Grupo = montarMarcador({ tag: "2024", tem: true });
    expect(avaliarGrupo(grupo, escopo(["2024"], []))).toBe(true);
    expect(avaliarGrupo(grupo, escopo(["2025"], []))).toBe(false);
  });
});
