import { describe, expect, it } from "vitest";

import { estadoDeAcesso, mesDepois, pagoAteDasCobrancas, type LinhaDeAssinatura } from "./acesso";

const LIGADA = { ligada: true, diasTolerancia: 3 };

function linha(over: Partial<LinhaDeAssinatura> = {}): LinhaDeAssinatura {
  return { status: "trial", isenta: false, trial_termina_em: null, pago_ate: null, ...over };
}

// Trial de 7 dias começando 2026-10-01T12:00Z termina 2026-10-08T12:00Z.
const FIM_TRIAL = "2026-10-08T12:00:00.000Z";

describe("estadoDeAcesso", () => {
  it("cobrança desligada libera tudo, até trial vencido", () => {
    const e = estadoDeAcesso(linha({ trial_termina_em: "2020-01-01T00:00:00Z" }), { ligada: false, diasTolerancia: 3 });
    expect(e).toMatchObject({ liberado: true, motivo: "cobranca_desligada" });
  });

  it("isenta libera mesmo sem trial nem pagamento", () => {
    expect(estadoDeAcesso(linha({ isenta: true }), LIGADA).motivo).toBe("isenta");
  });

  it("um minuto antes do fim do trial: liberado, com aviso", () => {
    const e = estadoDeAcesso(linha({ trial_termina_em: FIM_TRIAL }), LIGADA, new Date("2026-10-08T11:59:00Z"));
    expect(e).toMatchObject({ liberado: true, motivo: "trial", diasRestantes: 1, emAviso: true });
  });

  it("no início do trial não há aviso", () => {
    const e = estadoDeAcesso(linha({ trial_termina_em: FIM_TRIAL }), LIGADA, new Date("2026-10-01T12:00:00Z"));
    expect(e).toMatchObject({ liberado: true, diasRestantes: 7, emAviso: false });
  });

  it("trial vencido BLOQUEIA sem tolerância", () => {
    const e = estadoDeAcesso(linha({ trial_termina_em: FIM_TRIAL }), LIGADA, new Date("2026-10-08T12:00:01Z"));
    expect(e).toMatchObject({ liberado: false, motivo: "trial_vencido" });
  });

  it("pago até o futuro: ativa", () => {
    const e = estadoDeAcesso(
      linha({ status: "ativa", pago_ate: "2026-11-08T00:00:00Z" }),
      LIGADA,
      new Date("2026-10-20T00:00:00Z"),
    );
    expect(e).toMatchObject({ liberado: true, motivo: "ativa", emAviso: false });
  });

  it("pagamento vencido: 3 dias de tolerância liberados, com aviso", () => {
    const base = linha({ status: "inadimplente", pago_ate: "2026-11-08T00:00:00Z" });
    expect(estadoDeAcesso(base, LIGADA, new Date("2026-11-10T23:59:00Z"))).toMatchObject({
      liberado: true,
      motivo: "tolerancia",
      emAviso: true,
    });
    expect(estadoDeAcesso(base, LIGADA, new Date("2026-11-11T00:00:01Z"))).toMatchObject({
      liberado: false,
      motivo: "inadimplente",
    });
  });

  it("pagar libera NA HORA: basta o pago_ate avançar", () => {
    const agora = new Date("2026-11-20T00:00:00Z");
    const antes = linha({ status: "inadimplente", pago_ate: "2026-11-08T00:00:00Z" });
    expect(estadoDeAcesso(antes, LIGADA, agora).liberado).toBe(false);
    expect(estadoDeAcesso({ ...antes, status: "ativa", pago_ate: "2026-12-08T00:00:00Z" }, LIGADA, agora).liberado).toBe(true);
  });

  it("cancelada vale até o pago_ate e NÃO ganha tolerância", () => {
    const c = linha({ status: "cancelada", pago_ate: "2026-11-08T00:00:00Z" });
    expect(estadoDeAcesso(c, LIGADA, new Date("2026-11-07T00:00:00Z")).liberado).toBe(true);
    expect(estadoDeAcesso(c, LIGADA, new Date("2026-11-08T00:00:01Z")).liberado).toBe(false);
  });

  it("trial ainda correndo com pagamento antecipado: vale o maior (ativa)", () => {
    const e = estadoDeAcesso(
      linha({ trial_termina_em: FIM_TRIAL, pago_ate: "2026-11-05T00:00:00Z" }),
      LIGADA,
      new Date("2026-10-05T00:00:00Z"),
    );
    expect(e.motivo).toBe("ativa");
  });
});

describe("pago_ate derivado das cobranças", () => {
  it("mês de calendário sem pular para março", () => {
    expect(mesDepois("2027-01-31")).toBe("2027-02-28T00:00:00.000Z");
    expect(mesDepois("2028-01-31")).toBe("2028-02-29T00:00:00.000Z");
    expect(mesDepois("2026-10-10")).toBe("2026-11-10T00:00:00.000Z");
  });

  it("CONFIRMED e depois RECEIVED da mesma cobrança não dá dois meses", () => {
    const umEvento = pagoAteDasCobrancas([{ status: "CONFIRMED", vencimento: "2026-10-10" }]);
    const doisEventos = pagoAteDasCobrancas([{ status: "RECEIVED", vencimento: "2026-10-10" }]);
    expect(umEvento).toBe(doisEventos);
    expect(umEvento).toBe("2026-11-10T00:00:00.000Z");
  });

  it("vale a MAIOR cobrança paga; pendente e estornada não contam", () => {
    expect(
      pagoAteDasCobrancas([
        { status: "RECEIVED", vencimento: "2026-10-10" },
        { status: "REFUNDED", vencimento: "2026-11-10" },
        { status: "PENDING", vencimento: "2026-12-10" },
      ]),
    ).toBe("2026-11-10T00:00:00.000Z");
  });

  it("nenhuma paga = null", () => {
    expect(pagoAteDasCobrancas([{ status: "OVERDUE", vencimento: "2026-10-10" }])).toBeNull();
  });
});
