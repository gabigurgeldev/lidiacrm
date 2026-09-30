import { describe, expect, it } from "vitest";

import {
  criarMensagemAgendadaSchema,
  telefoneDoAvisoSchema,
} from "@/lib/schemas/mensagem-agendada";

describe("telefone do aviso — digitado como se fala, gravado em E.164", () => {
  it.each([
    ["11 98765-4321", "+5511987654321"],
    ["(11) 98765-4321", "+5511987654321"],
    ["+55 11 98765-4321", "+5511987654321"],
    ["+1 939 230 1037", "+19392301037"],
    ["5511987654321", "+5511987654321"],
  ])("%s → %s", (entrada, saida) => {
    expect(telefoneDoAvisoSchema.parse(entrada)).toBe(saida);
  });

  it.each(["", "123", "abc"])("%j é recusado", (entrada) => {
    expect(telefoneDoAvisoSchema.safeParse(entrada).success).toBe(false);
  });
});

describe("pedido de agendamento", () => {
  const base = {
    body: "Oi!",
    scheduled_for: "2026-10-01T12:00:00.000Z",
    channel_session_id: "11111111-1111-4111-8111-111111111111",
  };

  it("aceita sem aviso", () => {
    expect(criarMensagemAgendadaSchema.safeParse(base).success).toBe(true);
  });

  it("recusa texto vazio (só espaços)", () => {
    expect(criarMensagemAgendadaSchema.safeParse({ ...base, body: "   " }).success).toBe(false);
  });

  it("recusa horário sem fuso — seria lido no fuso do servidor", () => {
    expect(
      criarMensagemAgendadaSchema.safeParse({ ...base, scheduled_for: "2026-10-01T12:00" }).success,
    ).toBe(false);
  });

  it("aviso precisa de telefone E texto", () => {
    expect(
      criarMensagemAgendadaSchema.safeParse({ ...base, notify: { phone: "11987654321", body: "" } })
        .success,
    ).toBe(false);
    const ok = criarMensagemAgendadaSchema.parse({
      ...base,
      notify: { phone: "11987654321", body: "Ligar" },
    });
    expect(ok.notify?.phone).toBe("+5511987654321");
  });
});
