/**
 * O RECORTE DA LISTA — quem entra, quem não, e o número honesto que a tela mostra.
 *
 * Dois invariantes aqui valem mais que os outros:
 *
 *   * a régua é a MESMA da automação (`checarContato`), não uma segunda cópia;
 *   * a mesma pessoa por variante de nono dígito não recebe duas vezes — o
 *     índice único do banco compara TEXTO e não a pegaria.
 */
import { describe, expect, it } from "vitest";

import type { ContatoDoContexto } from "@/lib/automation/guarda-do-contato";
import { recortarContatos } from "@/lib/bulk-send/montagem";

function c(over: Partial<ContatoDoContexto> & { id: string }): ContatoDoContexto {
  return { phone_number: "+5511999990000", is_blocked: false, ...over };
}

describe("recorte — quem entra", () => {
  it("contato saudável entra como pendente", () => {
    const r = recortarContatos([c({ id: "a" })], 1);
    expect(r.vaoReceber).toBe(1);
    expect(r.linhas).toEqual([{ contact_id: "a", status: "pending", skip_reason: null }]);
    expect(r.foraPorMotivo).toEqual({});
  });

  it("conta quantos foram pedidos e não existem nesta organização", () => {
    // Três ids pedidos, um só voltou do banco: os outros dois são de outra org
    // (a RLS os escondeu) ou não existem. O operador precisa ver isso.
    const r = recortarContatos([c({ id: "a" })], 3);
    expect(r.naoEncontrados).toBe(2);
  });
});

describe("recorte — quem fica de fora, e com que motivo", () => {
  it("bloqueado", () => {
    const r = recortarContatos([c({ id: "a", is_blocked: true })], 1);
    expect(r.vaoReceber).toBe(0);
    expect(r.foraPorMotivo).toEqual({ contact_blocked: 1 });
    expect(r.linhas[0]).toEqual({
      contact_id: "a",
      status: "skipped",
      skip_reason: "contact_blocked",
    });
  });

  it("sem telefone", () => {
    const r = recortarContatos([c({ id: "a", phone_number: null })], 1);
    expect(r.foraPorMotivo).toEqual({ no_phone: 1 });
  });

  it("anonimizado", () => {
    const r = recortarContatos([c({ id: "a", is_anonymized: true })], 1);
    expect(r.foraPorMotivo).toEqual({ contact_anonymized: 1 });
  });

  it("mesclado", () => {
    const r = recortarContatos([c({ id: "a", is_merged_into: "b" })], 1);
    expect(r.foraPorMotivo).toEqual({ contact_merged: 1 });
  });

  /**
   * A régua é `declined_at`, NUNCA a ausência de `granted_at`. O default da
   * coluna `contacts.consent` já tem a mesma forma que uma recusa deixaria —
   * gatear por ausência bloquearia a instalação inteira, incluindo quem nunca
   * foi perguntado. O racional medido está em `guarda-do-contato.ts`.
   */
  it("quem recusou marketing fica fora; quem nunca foi perguntado ENTRA", () => {
    const recusou = c({
      id: "a",
      consent: { marketing: { granted_at: null, declined_at: "2026-08-01T00:00:00Z" } },
    });
    const nuncaPerguntado = c({
      id: "b",
      phone_number: "+5511988887777",
      consent: { marketing: { granted_at: null, declined_at: null } },
    });

    const r = recortarContatos([recusou, nuncaPerguntado], 2);
    expect(r.vaoReceber).toBe(1);
    expect(r.foraPorMotivo).toEqual({ consent_declined: 1 });
  });

  it("agrupa os motivos para a tela de confirmação", () => {
    const r = recortarContatos(
      [
        c({ id: "a", is_blocked: true }),
        c({ id: "b", is_blocked: true, phone_number: "+5511911112222" }),
        c({ id: "c", phone_number: null }),
        c({ id: "d", phone_number: "+5511933334444" }),
      ],
      4,
    );
    expect(r.vaoReceber).toBe(1);
    expect(r.foraPorMotivo).toEqual({ contact_blocked: 2, no_phone: 1 });
  });
});

describe("dedupe — a mesma pessoa não recebe duas vezes", () => {
  it("nono dígito: +5511999998888 e +551199998888 são a mesma pessoa", () => {
    const r = recortarContatos(
      [c({ id: "a", phone_number: "+5511999998888" }), c({ id: "b", phone_number: "+551199998888" })],
      2,
    );
    expect(r.vaoReceber).toBe(1);
    expect(r.repetidos).toBe(1);
    // A linha repetida NÃO vira destinatário — nem como pulado. Não é decisão
    // sobre a pessoa (ela vai receber, pela outra linha), é a lista não a
    // duplicando; contá-la como "fora" faria a tela mentir para baixo.
    expect(r.linhas).toHaveLength(1);
  });

  it("telefones diferentes não são deduplicados", () => {
    const r = recortarContatos(
      [c({ id: "a", phone_number: "+5511999998888" }), c({ id: "b", phone_number: "+5521999998888" })],
      2,
    );
    expect(r.vaoReceber).toBe(2);
    expect(r.repetidos).toBe(0);
  });

  it("pulado não ocupa o telefone — quem vale é quem PODE receber", () => {
    // O bloqueado sai; o gêmeo dele, saudável, tem de entrar. Marcar o telefone
    // como visto no pulo faria a pessoa não receber por nenhuma das duas linhas.
    const r = recortarContatos(
      [
        c({ id: "a", phone_number: "+5511999998888", is_blocked: true }),
        c({ id: "b", phone_number: "+551199998888" }),
      ],
      2,
    );
    expect(r.vaoReceber).toBe(1);
    expect(r.linhas.find((l) => l.status === "pending")?.contact_id).toBe("b");
  });
});
