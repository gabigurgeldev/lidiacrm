import { describe, expect, it } from "vitest";

import {
  estadoDaConta,
  hashDeEmail,
  recusaDeAcaoNaConta,
  recusaDeMudancaNoVinculo,
} from "./gestao-usuarios";

/**
 * As travas que impedem o painel da plataforma de trancar a instalação para
 * fora de si mesma. Cada caso nomeia o estado que ele proíbe.
 */

const ATOR = "11111111-1111-4111-8111-111111111111";
const ALVO = "22222222-2222-4222-8222-222222222222";
const AGORA = new Date("2026-09-28T12:00:00Z");

describe("estadoDaConta", () => {
  it("banimento no futuro = suspenso", () => {
    expect(
      estadoDaConta(
        { banned_until: "2126-01-01T00:00:00Z", email_confirmed_at: "x", last_sign_in_at: "x" },
        AGORA,
      ),
    ).toBe("suspenso");
  });

  it("banimento que já venceu NÃO é suspenso", () => {
    expect(
      estadoDaConta(
        { banned_until: "2026-01-01T00:00:00Z", email_confirmed_at: "x", last_sign_in_at: "x" },
        AGORA,
      ),
    ).toBe("ativo");
  });

  it("nunca entrou e nunca confirmou = pendente", () => {
    expect(
      estadoDaConta({ banned_until: null, email_confirmed_at: null, last_sign_in_at: null }, AGORA),
    ).toBe("pendente");
  });

  it("criada pelo painel (e-mail confirmado) mas nunca entrou = ativo", () => {
    expect(
      estadoDaConta({ banned_until: null, email_confirmed_at: "x", last_sign_in_at: null }, AGORA),
    ).toBe("ativo");
  });
});

describe("recusaDeAcaoNaConta", () => {
  const base = { atorId: ATOR, alvoId: ALVO, alvoEhPlatformAdmin: false, platformAdminsAtivos: 2 };

  it.each(["suspender", "excluir"] as const)("recusa %s a PRÓPRIA conta", (acao) => {
    expect(recusaDeAcaoNaConta({ ...base, acao, alvoId: ATOR })?.motivo).toBe("propria_conta");
  });

  it.each(["suspender", "excluir"] as const)("recusa %s o ÚLTIMO platform admin", (acao) => {
    expect(
      recusaDeAcaoNaConta({ ...base, acao, alvoEhPlatformAdmin: true, platformAdminsAtivos: 1 })
        ?.motivo,
    ).toBe("ultimo_admin");
  });

  it("permite suspender um platform admin quando há outro", () => {
    expect(
      recusaDeAcaoNaConta({ ...base, acao: "suspender", alvoEhPlatformAdmin: true, platformAdminsAtivos: 2 }),
    ).toBeNull();
  });

  it("recusa suspender quem já está suspenso", () => {
    expect(recusaDeAcaoNaConta({ ...base, acao: "suspender", alvoJaSuspenso: true })?.motivo).toBe(
      "estado",
    );
  });

  it("permite o caso comum", () => {
    expect(recusaDeAcaoNaConta({ ...base, acao: "excluir" })).toBeNull();
  });
});

describe("recusaDeMudancaNoVinculo", () => {
  it("recusa REBAIXAR o último admin da organização", () => {
    expect(
      recusaDeMudancaNoVinculo({ papelAtual: "admin", papelNovo: "agent", revogado: false, adminsAtivosNaOrg: 1 })
        ?.motivo,
    ).toBe("ultimo_admin");
  });

  it("recusa REMOVER o último admin da organização", () => {
    const r = recusaDeMudancaNoVinculo({
      papelAtual: "admin",
      papelNovo: null,
      revogado: false,
      adminsAtivosNaOrg: 1,
    });
    expect(r?.motivo).toBe("ultimo_admin");
    expect(r?.message).toMatch(/remover/);
  });

  it("permite rebaixar admin quando há outro", () => {
    expect(
      recusaDeMudancaNoVinculo({ papelAtual: "admin", papelNovo: "manager", revogado: false, adminsAtivosNaOrg: 2 }),
    ).toBeNull();
  });

  it("admin → admin não é rebaixamento, mesmo sendo o único", () => {
    expect(
      recusaDeMudancaNoVinculo({ papelAtual: "admin", papelNovo: "admin", revogado: false, adminsAtivosNaOrg: 1 }),
    ).toBeNull();
  });

  it("vínculo já revogado não muda", () => {
    expect(
      recusaDeMudancaNoVinculo({ papelAtual: "agent", papelNovo: "manager", revogado: true, adminsAtivosNaOrg: 3 })
        ?.motivo,
    ).toBe("estado");
  });

  it("remover quem não é admin passa mesmo com um admin só", () => {
    expect(
      recusaDeMudancaNoVinculo({ papelAtual: "agent", papelNovo: null, revogado: false, adminsAtivosNaOrg: 1 }),
    ).toBeNull();
  });
});

describe("hashDeEmail", () => {
  it("nunca devolve o e-mail cru", () => {
    const h = hashDeEmail("Pessoa@Exemplo.com");
    expect(h).not.toContain("@");
    expect(h).not.toMatch(/pessoa/i);
    expect(hashDeEmail("pessoa@exemplo.com")).toBe(h);
  });
});
