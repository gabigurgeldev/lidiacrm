/**
 * O RELÓGIO COMPARTILHADO — a superfície que a extração criou.
 *
 * `tests/unit/janela-de-atendimento.test.ts` continua medindo o lado do agente
 * (a leitura de `trigger_config.filters.business_hours`) e passou sem uma linha
 * de edição quando a conta mudou de casa — é ele que prova que a extração não
 * mudou comportamento.
 *
 * O que ele NÃO alcança é a porta que o motor de fluxos usa: o bloco
 * "Horário de funcionamento" chama `lerJanelaSemanal` com os quatro campos na
 * mão, sem jsonb nenhum no caminho. Sem este arquivo, a normalização usada por
 * um dos dois consumidores ficaria coberta só de lado.
 */
import { describe, expect, it } from "vitest";

import {
  fusoConhecido,
  lerJanelaSemanal,
  minutosDe,
  msAteAJanelaAbrir,
} from "@/lib/horario/janela-semanal";

const SEG_A_SEX = {
  timezone: "America/Sao_Paulo",
  start: "08:00",
  end: "18:00",
  weekdays: [1, 2, 3, 4, 5],
};

describe("lerJanelaSemanal — o que dá para obedecer", () => {
  it("⭐ aceita a janela comum e deduplica os dias", () => {
    expect(lerJanelaSemanal({ ...SEG_A_SEX, weekdays: [1, 1, 2] })).toEqual({
      ...SEG_A_SEX,
      weekdays: [1, 2],
    });
  });

  it("⭐ recusa a janela que atravessa a meia-noite", () => {
    // Recusar é melhor que interpretar ao contrário: `fim <= inicio` viraria
    // "fechado sempre", que é a mordaça que este módulo não pode criar.
    expect(lerJanelaSemanal({ ...SEG_A_SEX, start: "22:00", end: "02:00" })).toBeNull();
    expect(lerJanelaSemanal({ ...SEG_A_SEX, start: "08:00", end: "08:00" })).toBeNull();
  });

  it("⭐ recusa fuso que o runtime não conhece, dias vazios e hora torta", () => {
    expect(lerJanelaSemanal({ ...SEG_A_SEX, timezone: "America/Asunción" })).toBeNull();
    expect(lerJanelaSemanal({ ...SEG_A_SEX, weekdays: [] })).toBeNull();
    expect(lerJanelaSemanal({ ...SEG_A_SEX, weekdays: [9, 12] })).toBeNull();
    expect(lerJanelaSemanal({ ...SEG_A_SEX, start: "8:00" })).toBeNull();
    expect(lerJanelaSemanal({ ...SEG_A_SEX, start: "24:00" })).toBeNull();
  });

  it("aceita só o que É string e array — jsonb e config de tela erram diferente", () => {
    expect(lerJanelaSemanal({ start: "08:00", end: "18:00", weekdays: [1] })).toBeNull();
    expect(lerJanelaSemanal({ ...SEG_A_SEX, weekdays: "1,2,3" })).toBeNull();
    expect(lerJanelaSemanal({ ...SEG_A_SEX, start: 800 })).toBeNull();
  });
});

describe("msAteAJanelaAbrir", () => {
  const janela = lerJanelaSemanal(SEG_A_SEX)!;

  it("⭐ dentro da janela devolve null", () => {
    // Terça, 10:00 em São Paulo.
    expect(msAteAJanelaAbrir(janela, new Date("2026-09-08T13:00:00.000Z"))).toBeNull();
  });

  it("⭐ domingo à noite espera até a segunda de manhã, não 24h fixas", () => {
    // Domingo 20:00 SP → segunda 08:00 SP. Uma conta que só somasse "um dia"
    // acordaria domingo 08:00, que continua fechado.
    expect(msAteAJanelaAbrir(janela, new Date("2026-09-13T23:00:00.000Z"))).toBe(12 * 3_600_000);
  });

  it("⭐ depois do fim do expediente, a próxima abertura é no dia seguinte", () => {
    // Terça 19:00 SP → quarta 08:00 SP.
    expect(msAteAJanelaAbrir(janela, new Date("2026-09-08T22:00:00.000Z"))).toBe(13 * 3_600_000);
  });

  it("⭐ sexta à noite pula o fim de semana inteiro", () => {
    // Sexta 19:00 SP → segunda 08:00 SP: 61 horas, e não 13.
    expect(msAteAJanelaAbrir(janela, new Date("2026-09-11T22:00:00.000Z"))).toBe(61 * 3_600_000);
  });

  it("antes de abrir, no mesmo dia, espera só o que falta", () => {
    // Terça 06:30 SP → 1h30.
    expect(msAteAJanelaAbrir(janela, new Date("2026-09-08T09:30:00.000Z"))).toBe(90 * 60_000);
  });
});

describe("helpers", () => {
  it("minutosDe só aceita HH:MM de 24h", () => {
    expect(minutosDe("00:00")).toBe(0);
    expect(minutosDe("23:59")).toBe(23 * 60 + 59);
    expect(minutosDe("24:00")).toBeNull();
    expect(minutosDe("7:00")).toBeNull();
  });

  it("fusoConhecido pergunta ao Intl, não a uma lista nossa", () => {
    expect(fusoConhecido("America/Sao_Paulo")).toBe(true);
    expect(fusoConhecido("UTC")).toBe(true);
    expect(fusoConhecido("America/Asunción")).toBe(false);
  });
});
