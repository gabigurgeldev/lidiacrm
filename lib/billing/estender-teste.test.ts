import { describe, expect, it } from "vitest";

import type { LinhaDeAssinatura } from "./acesso";
import { estadoDeAcesso } from "./acesso";
import { novaDataDoTeste, podeEstender, statusDepoisDeEstender } from "./estender-teste";

const AGORA = new Date("2026-10-09T12:00:00.000Z");

function linha(over: Partial<LinhaDeAssinatura> = {}): LinhaDeAssinatura {
  return { status: "trial", isenta: false, trial_termina_em: null, pago_ate: null, ...over };
}

describe("novaDataDoTeste", () => {
  it("teste ainda valendo: soma ao FIM atual, sem perder os dias que a org já tinha", () => {
    const fim = "2026-10-12T12:00:00.000Z";
    expect(novaDataDoTeste(fim, AGORA, 7).toISOString()).toBe("2026-10-19T12:00:00.000Z");
  });

  it("teste já vencido: soma a AGORA — senão +7 num teste vencido há 10 dias continuaria vencido", () => {
    const fim = "2026-09-29T12:00:00.000Z";
    expect(novaDataDoTeste(fim, AGORA, 7).toISOString()).toBe("2026-10-16T12:00:00.000Z");
  });

  it("sem data de fim (ou data inválida): soma a agora", () => {
    expect(novaDataDoTeste(null, AGORA, 1).toISOString()).toBe("2026-10-10T12:00:00.000Z");
    expect(novaDataDoTeste("lixo", AGORA, 1).toISOString()).toBe("2026-10-10T12:00:00.000Z");
  });

  it("a data gravada LIBERA na regra de acesso — teste vencido + 7 volta a ser trial", () => {
    const vencida = linha({ trial_termina_em: "2026-09-29T12:00:00.000Z" });
    expect(estadoDeAcesso(vencida, { ligada: true, diasTolerancia: 3 }, AGORA).liberado).toBe(false);
    const estendida = linha({ trial_termina_em: novaDataDoTeste(vencida.trial_termina_em, AGORA, 7).toISOString() });
    expect(estadoDeAcesso(estendida, { ligada: true, diasTolerancia: 3 }, AGORA)).toMatchObject({
      liberado: true,
      motivo: "trial",
      diasRestantes: 7,
    });
  });
});

describe("podeEstender", () => {
  it("trial em curso ou vencido: pode", () => {
    expect(podeEstender(linha(), AGORA)).toEqual({ pode: true });
    expect(podeEstender(linha({ status: "inadimplente", pago_ate: "2026-09-01T00:00:00Z" }), AGORA)).toEqual({
      pode: true,
    });
  });

  it("cancelada: não pode — a regra de acesso ignora o trial de assinatura cancelada", () => {
    expect(podeEstender(linha({ status: "cancelada" }), AGORA)).toEqual({ pode: false, motivo: "cancelada" });
  });

  it("paga até o futuro: não pode", () => {
    expect(podeEstender(linha({ status: "ativa", pago_ate: "2026-11-01T00:00:00Z" }), AGORA)).toEqual({
      pode: false,
      motivo: "paga",
    });
  });

  it("isenta: não pode", () => {
    expect(podeEstender(linha({ isenta: true }), AGORA)).toEqual({ pode: false, motivo: "isenta" });
  });
});

describe("statusDepoisDeEstender", () => {
  it("quem nunca pagou volta a trial", () => {
    expect(statusDepoisDeEstender(linha({ status: "inadimplente" }))).toBe("trial");
  });

  it("quem já pagou mantém a história de pagamento", () => {
    expect(statusDepoisDeEstender(linha({ status: "inadimplente", pago_ate: "2026-09-01T00:00:00Z" }))).toBe(
      "inadimplente",
    );
  });
});
