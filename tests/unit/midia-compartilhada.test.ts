import { describe, expect, it } from "vitest";

import {
  CHAVES_DE_MIDIA_COMPARTILHADA,
  caminhoDaOrigemValido,
  midiaCompartilhadaDaMensagem,
  prefixoDaOrigem,
  temMidiaCompartilhada,
} from "@/lib/messaging/media/midia-compartilhada";

/**
 * MÍDIA COMPARTILHADA — o arquivo da organização que muitas mensagens apontam.
 *
 * Quem lê (a rota que assina a URL, a bolha da conversa) e quem escreve (o
 * handler de envio) dividem estas regras. O que cada caso protege:
 *
 *  - a PASTA é por origem: uma foto do acervo não pode passar como mídia de
 *    disparo, e vice-versa;
 *  - a ORG é conferida: a assinatura usa a service role, que não passa pela RLS
 *    do Storage — caminho de outra organização tem de virar "sem mídia";
 *  - caminho que SOBE de pasta (`..`) não passa, mesmo começando no prefixo.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const OUTRA = "99999999-9999-4999-8999-999999999999";

describe("prefixoDaOrigem / caminhoDaOrigemValido", () => {
  it("cada origem tem a sua pasta", () => {
    expect(prefixoDaOrigem(ORG, "disparo")).toBe(`${ORG}/disparos/`);
    expect(prefixoDaOrigem(ORG, "material")).toBe(`${ORG}/materiais/`);
  });

  it("aceita a pasta da origem desta org", () => {
    expect(caminhoDaOrigemValido(`${ORG}/materiais/a.jpg`, ORG, "material")).toBe(true);
    expect(caminhoDaOrigemValido(`${ORG}/disparos/c.mp4`, ORG, "disparo")).toBe(true);
  });

  it("recusa a pasta da OUTRA origem", () => {
    expect(caminhoDaOrigemValido(`${ORG}/disparos/c.jpg`, ORG, "material")).toBe(false);
    expect(caminhoDaOrigemValido(`${ORG}/materiais/a.jpg`, ORG, "disparo")).toBe(false);
  });

  it("recusa outra organização e caminho que sobe de pasta", () => {
    expect(caminhoDaOrigemValido(`${OUTRA}/materiais/a.jpg`, ORG, "material")).toBe(false);
    expect(caminhoDaOrigemValido(`${ORG}/materiais/../${OUTRA}/x.jpg`, ORG, "material")).toBe(false);
  });
});

describe("midiaCompartilhadaDaMensagem", () => {
  it("acha a foto do acervo e diz a origem", () => {
    expect(midiaCompartilhadaDaMensagem({ midia_do_material: `${ORG}/materiais/a.jpg` }, ORG)).toEqual({
      path: `${ORG}/materiais/a.jpg`,
      origem: "material",
    });
  });

  it("acha a mídia do disparo (o comportamento de antes)", () => {
    expect(midiaCompartilhadaDaMensagem({ midia_do_disparo: `${ORG}/disparos/c.jpg` }, ORG)).toEqual({
      path: `${ORG}/disparos/c.jpg`,
      origem: "disparo",
    });
  });

  it("caminho de outra org ou na chave errada vira null — 'sem mídia', nunca erro", () => {
    expect(midiaCompartilhadaDaMensagem({ midia_do_material: `${OUTRA}/materiais/a.jpg` }, ORG)).toBeNull();
    expect(midiaCompartilhadaDaMensagem({ midia_do_material: `${ORG}/disparos/c.jpg` }, ORG)).toBeNull();
  });

  it("metadata ausente, vazia ou com tipo errado vira null", () => {
    expect(midiaCompartilhadaDaMensagem(null, ORG)).toBeNull();
    expect(midiaCompartilhadaDaMensagem(undefined, ORG)).toBeNull();
    expect(midiaCompartilhadaDaMensagem({}, ORG)).toBeNull();
    expect(midiaCompartilhadaDaMensagem({ midia_do_material: 42 }, ORG)).toBeNull();
    expect(midiaCompartilhadaDaMensagem("texto", ORG)).toBeNull();
  });
});

describe("temMidiaCompartilhada", () => {
  it("vê as duas origens", () => {
    expect(temMidiaCompartilhada({ midia_do_disparo: "x" })).toBe(true);
    expect(temMidiaCompartilhada({ midia_do_material: "x" })).toBe(true);
  });

  it("ignora metadata sem a chave ou com valor que não é texto", () => {
    expect(temMidiaCompartilhada(null)).toBe(false);
    expect(temMidiaCompartilhada({ outra: "x" })).toBe(false);
    expect(temMidiaCompartilhada({ midia_do_material: null })).toBe(false);
  });
});

describe("CHAVES_DE_MIDIA_COMPARTILHADA", () => {
  it("lista exatamente as chaves que o servidor escreve — o handler as remove do chamador", () => {
    expect([...CHAVES_DE_MIDIA_COMPARTILHADA].sort()).toEqual(["midia_do_disparo", "midia_do_material"]);
  });
});
