import { describe, expect, it } from "vitest";

import { corpoDeTemplateStevo } from "@/lib/channels/stevo/envelope";

describe("corpoDeTemplateStevo", () => {
  it("ordena os parâmetros por número, não por ordem de chave", () => {
    const corpo = corpoDeTemplateStevo("boas_vindas", "pt_BR", { "2": "b", "1": "a", "3": "c" });
    expect(corpo.template_name).toBe("boas_vindas");
    expect(corpo.template_language).toBe("pt_BR");
    expect(corpo.template_params).toEqual(["a", "b", "c"]);
  });

  it("ignora chave não-numérica (nunca em ordem alfabética)", () => {
    const corpo = corpoDeTemplateStevo("x", "pt_BR", { nome: "Ana", "1": "a" });
    expect(corpo.template_params).toEqual(["a"]);
  });

  it("sem parâmetros não manda template_params", () => {
    const corpo = corpoDeTemplateStevo("x", "pt_BR", {});
    expect(corpo.template_params).toBeUndefined();
  });

  it("idioma vazio é omitido", () => {
    const corpo = corpoDeTemplateStevo("x", "", { "1": "a" });
    expect(corpo.template_language).toBeUndefined();
  });
});
