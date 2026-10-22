/**
 * `cabeNaAgenda` — o teste de UM instante, que é como a APOIO é julgada.
 *
 * A apoio não gera grade: ela só precisa estar livre no horário que a grade da
 * principal oferece. Cada `it` aqui é uma frase que, falsa, oferece um
 * procedimento sem a segunda pessoa — ou esconde um que ela poderia auxiliar.
 *
 * O último bloco é a cerca entre os dois caminhos: todo horário que
 * `horariosLivres` gera para uma pessoa tem de "caber" na agenda dela. Se as
 * duas funções divergirem, a principal e a apoio passam a ser julgadas por
 * regras diferentes sobre o mesmo bloqueio — o defeito que a DECISÃO 12 tirou do
 * motor uma vez.
 *
 * 2026-03-09 é uma segunda-feira. `agora` é sempre injetado.
 */
import { describe, expect, it } from "vitest";

import {
  cabeNaAgenda,
  horariosLivres,
  type ExcecaoDeData,
  type JornadaDaAgenda,
  type Ocupado,
  type TipoDeAgendamento,
} from "@/lib/agenda/horarios-livres";

const SP = "America/Sao_Paulo";

const JORNADA: JornadaDaAgenda = {
  timezone: SP,
  windows: [1, 2, 3, 4, 5].flatMap((dow) => [
    { dow, start: "09:00", end: "12:00" },
    { dow, start: "13:00", end: "18:00" },
  ]),
};

const UMA_HORA: TipoDeAgendamento = {
  duracaoMin: 60,
  bufferAntesMin: 0,
  bufferDepoisMin: 0,
  avisoMinimoMin: 0,
  janelaDias: 60,
};

const AGORA = new Date("2026-03-01T12:00:00Z");

/** Instante de uma hora de parede em São Paulo (GMT-3 em 2026). */
function sp(dataHora: string): Date {
  return new Date(`${dataHora}:00-03:00`);
}

function cabe(
  inicio: Date,
  extra: {
    ocupados?: Ocupado[];
    excecoes?: ExcecaoDeData[];
    tipo?: Partial<TipoDeAgendamento>;
    agora?: Date;
  } = {},
): boolean {
  return cabeNaAgenda(
    {
      jornada: JORNADA,
      excecoes: extra.excecoes ?? [],
      ocupados: extra.ocupados ?? [],
      tipo: { ...UMA_HORA, ...extra.tipo },
      agora: extra.agora ?? AGORA,
    },
    inicio,
  );
}

describe("a janela: CONTÉM, sem exigir a grade", () => {
  it("09:15 cabe numa jornada 09:00–12:00 — a grade é da principal, não da apoio", () => {
    expect(cabe(sp("2026-03-09T09:15"))).toBe(true);
  });

  it("11:30 de uma hora NÃO cabe: o atendimento passaria do fim da faixa", () => {
    expect(cabe(sp("2026-03-09T11:30"))).toBe(false);
  });

  it("12:00 não cabe — é o almoço, a ausência de janela", () => {
    expect(cabe(sp("2026-03-09T12:00"))).toBe(false);
  });

  it("17:00 cabe exatamente até o fim da faixa (encostar não é passar)", () => {
    expect(cabe(sp("2026-03-09T17:00"))).toBe(true);
  });

  it("sábado sem jornada não cabe", () => {
    expect(cabe(sp("2026-03-14T10:00"))).toBe(false);
  });
});

describe("o que ocupa", () => {
  it("um compromisso no mesmo horário impede", () => {
    const ocupados = [{ inicio: sp("2026-03-09T10:00"), fim: sp("2026-03-09T11:00") }];
    expect(cabe(sp("2026-03-09T10:00"), { ocupados })).toBe(false);
  });

  it("compromisso que termina quando o horário começa NÃO impede", () => {
    const ocupados = [{ inicio: sp("2026-03-09T09:00"), fim: sp("2026-03-09T10:00") }];
    expect(cabe(sp("2026-03-09T10:00"), { ocupados })).toBe(true);
  });

  it("o buffer infla o horário contra compromisso", () => {
    const ocupados = [{ inicio: sp("2026-03-09T09:00"), fim: sp("2026-03-09T10:00") }];
    expect(cabe(sp("2026-03-09T10:00"), { ocupados, tipo: { bufferAntesMin: 15 } })).toBe(false);
  });

  it("o buffer vale contra BLOQUEIO por exceção também — mesma régua da grade", () => {
    const excecoes: ExcecaoDeData[] = [
      { data: "2026-03-09", indisponivel: true, inicioMinuto: 11 * 60, fimMinuto: 12 * 60 },
    ];
    expect(cabe(sp("2026-03-09T10:00"), { excecoes })).toBe(true);
    expect(cabe(sp("2026-03-09T10:00"), { excecoes, tipo: { bufferDepoisMin: 15 } })).toBe(false);
  });

  it("dia inteiro bloqueado não cabe", () => {
    const excecoes: ExcecaoDeData[] = [
      { data: "2026-03-09", indisponivel: true, inicioMinuto: 0, fimMinuto: 1440 },
    ];
    expect(cabe(sp("2026-03-09T10:00"), { excecoes })).toBe(false);
  });

  it("exceção DISPONÍVEL substitui a jornada: sábado excepcional cabe", () => {
    const excecoes: ExcecaoDeData[] = [
      { data: "2026-03-14", indisponivel: false, inicioMinuto: 8 * 60, fimMinuto: 12 * 60 },
    ];
    expect(cabe(sp("2026-03-14T08:30"), { excecoes })).toBe(true);
  });
});

describe("antecedência e horizonte", () => {
  it("antes do aviso mínimo não cabe", () => {
    const agora = sp("2026-03-09T08:00");
    expect(cabe(sp("2026-03-09T09:00"), { agora, tipo: { avisoMinimoMin: 120 } })).toBe(false);
    expect(cabe(sp("2026-03-09T10:00"), { agora, tipo: { avisoMinimoMin: 120 } })).toBe(true);
  });

  it("além da janela de agendamento não cabe", () => {
    expect(cabe(sp("2026-03-09T10:00"), { tipo: { janelaDias: 3 } })).toBe(false);
  });

  it("duração zero nunca cabe (o motor também não gera nada)", () => {
    expect(cabe(sp("2026-03-09T10:00"), { tipo: { duracaoMin: 0 } })).toBe(false);
  });
});

describe("a cerca: os dois caminhos concordam", () => {
  it("todo horário que a grade gera CABE na agenda da mesma pessoa", () => {
    const ocupados = [{ inicio: sp("2026-03-10T10:30"), fim: sp("2026-03-10T11:30") }];
    const excecoes: ExcecaoDeData[] = [
      { data: "2026-03-11", indisponivel: true, inicioMinuto: 14 * 60, fimMinuto: 15 * 60 },
    ];
    const tipo = { ...UMA_HORA, bufferAntesMin: 10, bufferDepoisMin: 10, intervaloMin: 30 };
    const slots = horariosLivres({
      jornada: JORNADA,
      excecoes,
      ocupados,
      tipo,
      de: sp("2026-03-09T00:00"),
      ate: sp("2026-03-13T23:59"),
      agora: AGORA,
    });
    expect(slots.length, "a grade precisa gerar algo, senão a cerca mede o vazio").toBeGreaterThan(
      20,
    );
    for (const s of slots) {
      expect(
        cabeNaAgenda({ jornada: JORNADA, excecoes, ocupados, tipo, agora: AGORA }, s.inicio),
        `${s.inicio.toISOString()} está na grade e "não cabe" — as duas regras divergiram`,
      ).toBe(true);
    }
  });

  it("...e o PAR: o horário que a grade derrubou pelo compromisso também não cabe", () => {
    const ocupados = [{ inicio: sp("2026-03-10T10:30"), fim: sp("2026-03-10T11:30") }];
    expect(cabe(sp("2026-03-10T10:00"), { ocupados })).toBe(false);
    expect(cabe(sp("2026-03-10T11:00"), { ocupados })).toBe(false);
  });
});
