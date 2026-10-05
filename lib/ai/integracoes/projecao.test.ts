import { describe, expect, it } from "vitest";

import { TETO_DE_CARACTERES, projetarResposta } from "./projecao";

describe("projetarResposta", () => {
  it("sem campos declarados, passa tudo — menos o que tem cara de segredo", () => {
    const out = JSON.parse(
      projetarResposta({ nome: "Loja", api_key: "sk-123", dono: { senha: "x", cpf: "1", email: "a@b.c" } }, []),
    );
    expect(out).toEqual({ nome: "Loja", api_key: "[oculto]", dono: { senha: "[oculto]", cpf: "[oculto]", email: "a@b.c" } });
  });

  it("com campos declarados, só eles passam", () => {
    const out = JSON.parse(
      projetarResposta({ conta: { nome: "Loja", plano: "pro" }, cadastro: { endereco: "Rua X" } }, ["conta.nome"]),
    );
    expect(out).toEqual({ "conta.nome": "Loja" });
  });

  it("campo pedido que é segredo continua oculto", () => {
    expect(JSON.parse(projetarResposta({ token: "abc" }, ["token"]))).toEqual({ token: "[oculto]" });
  });

  it("expande array com *", () => {
    const out = JSON.parse(projetarResposta({ itens: [{ nome: "a", preco: 1 }, { nome: "b", preco: 2 }] }, ["itens.*.nome"]));
    expect(out).toEqual({ "itens.*.nome": ["a", "b"] });
  });

  it("corta no teto", () => {
    const out = projetarResposta({ texto: "z".repeat(TETO_DE_CARACTERES * 2) }, []);
    expect(out.length).toBeLessThan(TETO_DE_CARACTERES + 80);
    expect(out).toContain("[cortado");
  });
});
