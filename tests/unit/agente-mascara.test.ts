import { describe, expect, it } from "vitest";

import {
  mascararDocumento,
  mascararEmails,
  mascararNumerosLongos,
  mascararTelefone,
  mascararTextoLivre,
} from "@/agente/mascara";

/**
 * Texto livre (nome de contato, título de agendamento, nome de etapa) vai ao
 * modelo e volta como resposta copiável. Telefone e documento de TERCEIRO não
 * podem sair inteiros — e data não pode virar "•••• 2026" por engano.
 */
describe("assistente de suporte · máscara de dado de terceiro", () => {
  it.each([
    ["Maria 11 98765-4321", "Maria •••• 4321"],
    ["ligar +55 (11) 98765-4321", "ligar •••• 4321"],
    ["CPF 123.456.789-09", "CPF •••• 8909"],
    ["CNPJ 12.345.678/0001-90", "CNPJ •••• 0190"],
    ["celular sem DDD 98765-4321", "celular sem DDD •••• 4321"],
    ["fixo 3456 7890", "fixo •••• 7890"],
    ["colado 987654321", "colado •••• 4321"],
  ])("mascara %j", (entrada, esperado) => {
    expect(mascararNumerosLongos(entrada)).toBe(esperado);
  });

  it.each([
    "Retorno 03/11/2026",
    "Retorno 2026-11-03",
    "Retorno 03.11.2026",
    "às 14:30",
    "Sala 12",
    "R$ 1.234,56",
  ])("não confunde %j com telefone", (texto) => {
    expect(mascararNumerosLongos(texto)).toBe(texto);
  });

  it("só é data o que tem dia e mês válidos — o resto é número e é mascarado", () => {
    expect(mascararNumerosLongos("DDD 11/98765-4321")).toBe("DDD •••• 4321");
    expect(mascararNumerosLongos("dia 45/13/2026")).toBe("dia •••• 2026");
    expect(mascararNumerosLongos("Retorno 03/11/2026 14:30")).toBe("Retorno 03/11/2026 14:30");
    expect(mascararNumerosLongos("de 01/11/2026 a 30/11/2026")).toBe("de 01/11/2026 a 30/11/2026");
  });

  it("e-mail fica só com a inicial e o domínio", () => {
    expect(mascararEmails("fale com joana.silva+vip@gmail.com hoje")).toBe(
      "fale com j•••@gmail.com hoje",
    );
    expect(mascararTextoLivre("Joana <joana@empresa.com.br> 11 98765-4321")).toBe(
      "Joana <j•••@empresa.com.br> •••• 4321",
    );
  });

  it("telefone e documento estruturados mostram só o final", () => {
    expect(mascararTelefone("5511987651234")).toBe("•••• 1234");
    expect(mascararTelefone("")).toBeNull();
    expect(mascararDocumento("123.456.789-09")).toBe("•••••09");
  });
});
