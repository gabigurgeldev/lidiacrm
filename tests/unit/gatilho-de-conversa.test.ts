/**
 * O GATILHO DE MENSAGEM SÓ ARMA NO COMEÇO DA CONVERSA (migration 0228).
 *
 * Uma pré-triagem que arma em toda mensagem arma de novo com a própria
 * resposta do cliente ao menu. A regra pura decide; o default de cada campo
 * mantém todo fluxo já publicado igual.
 */
import { describe, expect, it } from "vitest";

import { decidirArmar, lerConfigDoGatilhoDeMensagem, precisaOlharAConversa } from "@/lib/flow-engine/gatilho-de-conversa";

const agora = new Date("2026-10-07T12:00:00Z");
const horasAtras = (h: number) => new Date(agora.getTime() - h * 3_600_000);

describe("lerConfigDoGatilhoDeMensagem", () => {
  it("config de fluxo já publicado (só canal) continua o de sempre", () => {
    const c = lerConfigDoGatilhoDeMensagem({ canal_id: null });
    expect(c).toMatchObject({ quando: "toda_mensagem", uma_por_contato: false, silenciar_ia: false, pular_se_pessoa_atende: false });
    expect(precisaOlharAConversa(c)).toBe(false);
  });

  it("config torto não derruba o matcher — vira o de sempre", () => {
    expect(lerConfigDoGatilhoDeMensagem({ quando: "nunca" }).quando).toBe("toda_mensagem");
  });
});

describe("decidirArmar", () => {
  const triagem = lerConfigDoGatilhoDeMensagem({
    quando: "conversa_nova_ou_retorno",
    horas_de_silencio: 24,
    pular_se_pessoa_atende: true,
  });

  it("primeira mensagem do cliente → arma", () => {
    expect(decidirArmar({ config: triagem, ultimaMensagemAntes: null, agora, pessoaAtendendo: false })).toEqual({ armar: true });
  });

  it("resposta ao menu, segundos depois → não arma de novo", () => {
    expect(decidirArmar({ config: triagem, ultimaMensagemAntes: new Date(agora.getTime() - 2_000), agora, pessoaAtendendo: false })).toEqual({
      armar: false,
      motivo: "conversa_em_andamento",
    });
  });

  it("volta depois de 24h sem conversa → arma", () => {
    expect(decidirArmar({ config: triagem, ultimaMensagemAntes: horasAtras(25), agora, pessoaAtendendo: false })).toEqual({ armar: true });
  });

  it("23h depois ainda é a mesma conversa", () => {
    expect(decidirArmar({ config: triagem, ultimaMensagemAntes: horasAtras(23), agora, pessoaAtendendo: false }).armar).toBe(false);
  });

  it("pessoa da equipe com a conversa → não arma, mesmo em conversa nova", () => {
    expect(decidirArmar({ config: triagem, ultimaMensagemAntes: null, agora, pessoaAtendendo: true })).toEqual({
      armar: false,
      motivo: "pessoa_atendendo",
    });
  });

  it("toda_mensagem ignora o histórico (o de sempre)", () => {
    const sempre = lerConfigDoGatilhoDeMensagem({});
    expect(decidirArmar({ config: sempre, ultimaMensagemAntes: new Date(agora.getTime() - 1_000), agora, pessoaAtendendo: true })).toEqual({
      armar: true,
    });
  });
});
