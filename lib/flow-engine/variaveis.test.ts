import { describe, expect, it } from "vitest";

import { caminhosCitados, interpolar, render } from "./variaveis";

const escopo = {
  lead: { title: "Loja do Gabriel", value_cents: 150_000, tags: ["quente", "meta-ads"], dono: null },
  contact: { name: "Gabriel" },
  vars: { dono_escolhido: "abc-123", zero: 0, falso: false },
};

describe("interpolar", () => {
  it("troca o caminho pelo valor", () => {
    expect(render("Novo lead: {{lead.title}}", escopo)).toBe("Novo lead: Loja do Gabriel");
    expect(render("Dono: {{vars.dono_escolhido}}", escopo)).toBe("Dono: abc-123");
  });

  it("aceita espaço dentro das chaves", () => {
    expect(render("{{ contact.name }}", escopo)).toBe("Gabriel");
  });

  it("zero e false viram texto, não sumiço", () => {
    // Um `if (valor)` ingênuo apagaria os dois, e "0 tentativas" viraria
    // " tentativas" numa mensagem que vai para o cliente.
    expect(render("{{vars.zero}} tentativas", escopo)).toBe("0 tentativas");
    expect(render("ativo={{vars.falso}}", escopo)).toBe("ativo=false");
  });

  it("lista vira texto separado por vírgula", () => {
    expect(render("{{lead.tags}}", escopo)).toBe("quente, meta-ads");
  });

  it("caminho ausente vira VAZIO, nunca a chave crua", () => {
    // Mandar `{{lead.name}}` literal numa mensagem de WhatsApp para o cliente é
    // pior que a lacuna.
    const r = interpolar("Olá {{lead.name}}!", escopo);
    expect(r.texto).toBe("Olá !");
    expect(r.ausentes).toEqual(["lead.name"]);
  });

  it("presente valendo null também conta como ausente", () => {
    const r = interpolar("{{lead.dono}}", escopo);
    expect(r.texto).toBe("");
    expect(r.ausentes).toEqual(["lead.dono"]);
  });

  it("relata cada caminho ausente uma vez só", () => {
    const r = interpolar("{{a.b}} e {{a.b}} e {{c.d}}", escopo);
    expect(r.ausentes).toEqual(["a.b", "c.d"]);
  });

  it("NÃO reescaneia o que foi substituído", () => {
    // Dado que veio de mensagem de WhatsApp não pode virar gabarito.
    const hostil = { contact: { name: "{{vars.segredo}}" }, vars: { segredo: "não deveria vazar" } };
    expect(render("Oi {{contact.name}}", hostil)).toBe("Oi {{vars.segredo}}");
  });

  it("deixa intacto o que não é um caminho", () => {
    expect(render("{{ 1 + 1 }}", escopo)).toBe("{{ 1 + 1 }}");
    expect(render("use {chaves} simples", escopo)).toBe("use {chaves} simples");
    expect(render("{{}}", escopo)).toBe("{{}}");
  });

  it("não atravessa um não-objeto no meio do caminho", () => {
    expect(interpolar("{{lead.title.length}}", escopo).ausentes).toEqual(["lead.title.length"]);
  });
});

describe("caminhosCitados", () => {
  it("lista os caminhos, sem repetir", () => {
    expect(caminhosCitados("{{lead.title}} {{vars.x}} {{lead.title}}")).toEqual([
      "lead.title",
      "vars.x",
    ]);
  });

  it("devolve vazio quando não há marcador", () => {
    expect(caminhosCitados("sem marcador nenhum")).toEqual([]);
  });
});
