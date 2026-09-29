/**
 * O admin da empresa edita nome, e-mail e senha da própria equipe — sem
 * alcançar a conta de quem também trabalha em OUTRA empresa da instalação.
 */
import { describe, expect, it } from "vitest";

import { recusaDeEdicaoDoMembro } from "@/lib/team/editar-membro";

const base = {
  atorId: "admin-a",
  alvoId: "pessoa",
  alvoEhPlatformAdmin: false,
  outrasEmpresasAtivas: 0,
  mudaAcesso: true,
};

describe("recusaDeEdicaoDoMembro", () => {
  it("pessoa só desta empresa: pode trocar e-mail e senha", () => {
    expect(recusaDeEdicaoDoMembro(base)).toBeNull();
  });

  it("pessoa em outra empresa: e-mail e senha recusados — seria tomar a conta de lá", () => {
    expect(recusaDeEdicaoDoMembro({ ...base, outrasEmpresasAtivas: 1 })?.motivo).toBe("outra_empresa");
  });

  it("pessoa em outra empresa: o nome ainda pode mudar", () => {
    expect(recusaDeEdicaoDoMembro({ ...base, outrasEmpresasAtivas: 1, mudaAcesso: false })).toBeNull();
  });

  it("admin da plataforma nunca é editado por uma empresa", () => {
    expect(
      recusaDeEdicaoDoMembro({ ...base, alvoEhPlatformAdmin: true, mudaAcesso: false })?.status,
    ).toBe(403);
  });

  it("a própria conta não se edita por aqui", () => {
    expect(recusaDeEdicaoDoMembro({ ...base, alvoId: "admin-a" })?.motivo).toBe("propria_conta");
  });
});
