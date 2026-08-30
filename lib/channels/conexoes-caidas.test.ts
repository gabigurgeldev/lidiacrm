import { describe, expect, it } from "vitest";

import { conexoesCaidasDe, STATUS_QUE_AVISAM } from "./health";

describe("conexoesCaidasDe", () => {
  it.each([...STATUS_QUE_AVISAM])("acende para %s", (status) => {
    expect(conexoesCaidasDe([{ id: "c1", status }])).toHaveLength(1);
  });

  it.each(["WORKING", "STARTING", "", null, undefined])("NÃO acende para %s", (status) => {
    // WORKING é o caso do defeito medido: a faixa continuava na tela com as duas
    // conexões de pé. STARTING está fora de propósito — avisar a cada boot ensina
    // o operador a ignorar a faixa (ver o cabeçalho de STATUS_QUE_AVISAM).
    expect(conexoesCaidasDe([{ id: "c1", status }])).toEqual([]);
  });

  it("ignora conexão arquivada — foi desligada de propósito", () => {
    expect(
      conexoesCaidasDe([{ id: "c1", status: "STOPPED", archived_at: "2026-08-30T00:00:00Z" }]),
    ).toEqual([]);
  });

  it("o apelido prefere o nome, cai no telefone, e só então em 'sem nome'", () => {
    const linhas = [
      { id: "a", status: "FAILED", display_name: "Vendas", phone_number: "5511999998888" },
      { id: "b", status: "FAILED", display_name: null, phone_number: "5511999997777" },
      { id: "c", status: "FAILED", display_name: null, phone_number: null },
    ];
    expect(conexoesCaidasDe(linhas).map((c) => c.apelido)).toEqual([
      "Vendas",
      "5511999997777",
      "sem nome",
    ]);
  });

  it("devolve só as caídas quando há mistura", () => {
    const saida = conexoesCaidasDe([
      { id: "viva1", status: "WORKING", display_name: "Gabriel Gurgel" },
      { id: "morta", status: "SCAN_QR_CODE", display_name: "Suporte" },
      { id: "viva2", status: "WORKING", display_name: "GABRIEL GURGEL" },
    ]);
    expect(saida).toEqual([{ id: "morta", apelido: "Suporte", status: "SCAN_QR_CODE" }]);
  });

  it("lista vazia não acende nada", () => {
    expect(conexoesCaidasDe([])).toEqual([]);
  });
});
