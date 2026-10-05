import { describe, expect, it } from "vitest";

import { decidirConfirmacao, ehAfirmativa, ehNegativa, type MensagemDoCliente } from "./confirmacao";

const OFERTA = new Date("2026-10-05T12:00:00Z");
const EXPIRA = new Date("2026-10-05T12:15:00Z");
const ACAO = { status: "aguardando", ofertaEnviadaEm: OFERTA, expiraEm: EXPIRA };

function msg(id: string, texto: string | null, minutosDepois: number, temMidia = false): MensagemDoCliente {
  return { id, texto, temMidia, criadaEm: new Date(OFERTA.getTime() + minutosDepois * 60_000) };
}

const AGORA = new Date("2026-10-05T12:05:00Z");

describe("ehAfirmativa — a mensagem inteira, nunca a palavra solta", () => {
  it.each(["sim", "Sim!", "SIM 👍", "pode sim", "Confirmo.", "ok", "pode fazer", "sim, pode"])(
    "aceita %s",
    (t) => expect(ehAfirmativa(t)).toBe(true),
  );
  it.each([
    "sim mas espera",
    "sim, antes me explica",
    "não",
    "sim?",
    "acho que sim",
    "sim, mas no outro canal",
    "pode? nao sei",
    "sim sim sim sim sim sim sim sim sim sim sim",
    "",
  ])("recusa %s", (t) => expect(ehAfirmativa(t)).toBe(false));
});

describe("ehNegativa", () => {
  it.each(["não", "Nao!", "cancela", "não quero"])("reconhece %s", (t) => expect(ehNegativa(t)).toBe(true));
  it("não confunde frase longa com negativa", () => expect(ehNegativa("não sei se entendi")).toBe(false));
});

describe("decidirConfirmacao", () => {
  it("primeira mensagem depois da oferta é SIM: confirma", () => {
    expect(decidirConfirmacao({ acao: ACAO, mensagensDoCliente: [msg("m1", "sim", 1)], agora: AGORA })).toEqual({
      tipo: "confirmar",
      mensagemId: "m1",
    });
  });

  it("SIM mandado ANTES da oferta não vale", () => {
    expect(decidirConfirmacao({ acao: ACAO, mensagensDoCliente: [msg("m0", "sim", -1)], agora: AGORA })).toEqual({
      tipo: "aguardar",
    });
  });

  it("só a PRIMEIRA conta: outra coisa e depois SIM não confirma", () => {
    const d = decidirConfirmacao({
      acao: ACAO,
      mensagensDoCliente: [msg("m2", "sim", 2), msg("m1", "qual canal?", 1)],
      agora: AGORA,
    });
    expect(d).toEqual({ tipo: "desconsiderar", mensagemId: "m1" });
  });

  it("negativa cancela", () => {
    expect(decidirConfirmacao({ acao: ACAO, mensagensDoCliente: [msg("m1", "não", 1)], agora: AGORA })).toEqual({
      tipo: "cancelar",
      mensagemId: "m1",
    });
  });

  it("áudio nunca confirma", () => {
    expect(
      decidirConfirmacao({ acao: ACAO, mensagensDoCliente: [msg("m1", "sim", 1, true)], agora: AGORA }),
    ).toEqual({ tipo: "desconsiderar", mensagemId: "m1" });
  });

  it("SIM depois do prazo não vale", () => {
    expect(
      decidirConfirmacao({ acao: ACAO, mensagensDoCliente: [msg("m1", "sim", 20)], agora: new Date("2026-10-05T12:30:00Z") }),
    ).toEqual({ tipo: "expirar" });
  });

  it("sem resposta e prazo vencido: expira", () => {
    expect(decidirConfirmacao({ acao: ACAO, mensagensDoCliente: [], agora: new Date("2026-10-05T12:16:00Z") })).toEqual({
      tipo: "expirar",
    });
  });

  it("oferta que não chegou ao cliente nunca é confirmada", () => {
    expect(
      decidirConfirmacao({
        acao: { ...ACAO, ofertaEnviadaEm: null },
        mensagensDoCliente: [msg("m1", "sim", 1)],
        agora: AGORA,
      }),
    ).toEqual({ tipo: "aguardar" });
  });

  it("ação que não está aguardando é ignorada (retry do job não executa de novo)", () => {
    expect(
      decidirConfirmacao({
        acao: { ...ACAO, status: "executada" },
        mensagensDoCliente: [msg("m1", "sim", 1)],
        agora: AGORA,
      }),
    ).toEqual({ tipo: "aguardar" });
  });
});
