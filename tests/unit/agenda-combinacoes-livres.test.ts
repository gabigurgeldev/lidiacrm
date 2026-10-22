/**
 * `combinacoesLivres` — os horários de um GRUPO de profissionais, e quem atende.
 *
 * A regra que o dono do produto fixou: quando o procedimento pede duas pessoas
 * (quem faz e quem auxilia), o horário só existe se AS DUAS estiverem livres.
 * Cada `it` é uma consequência dessa frase; a última é o salto do horário de
 * verão, que a grade de uma pessoa só já tinha pago uma vez e que a união de
 * várias não pode reabrir.
 *
 * 2026-03-09 é uma segunda-feira. `agora` é sempre injetado.
 */
import { describe, expect, it } from "vitest";

import { partesNoFuso } from "@/lib/agenda/fuso";
import {
  combinacoesLivres,
  horariosLivres,
  type JornadaDaAgenda,
  type PessoaDaBusca,
  type TipoDeAgendamento,
} from "@/lib/agenda/horarios-livres";
import type { SlotComProfissionais } from "@/lib/agenda/contrato";

const SP = "America/Sao_Paulo";
const AGORA = new Date("2026-03-01T12:00:00Z");

const UMA_HORA: TipoDeAgendamento = {
  duracaoMin: 60,
  bufferAntesMin: 0,
  bufferDepoisMin: 0,
  avisoMinimoMin: 0,
  janelaDias: 60,
};

function jornada(inicio: string, fim: string, fuso = SP): JornadaDaAgenda {
  return {
    timezone: fuso,
    windows: [1, 2, 3, 4, 5].map((dow) => ({ dow, start: inicio, end: fim })),
  };
}

function pessoa(id: string, j: JornadaDaAgenda, extra: Partial<PessoaDaBusca> = {}): PessoaDaBusca {
  return { id, jornada: j, excecoes: [], ocupados: [], ...extra };
}

function sp(dataHora: string): Date {
  return new Date(`${dataHora}:00-03:00`);
}

/** Segunda, 09/03 — o dia inteiro. */
const SEGUNDA = { de: sp("2026-03-09T00:00"), ate: sp("2026-03-09T23:59") };

function horas(slots: SlotComProfissionais[]): string[] {
  return slots.map((s) => {
    const p = partesNoFuso(s.inicio, SP);
    return `${String(p.hora).padStart(2, "0")}:${String(p.minuto).padStart(2, "0")}`;
  });
}

function opcoesDe(slots: SlotComProfissionais[], hora: string): string[] {
  const s = slots[horas(slots).indexOf(hora)];
  return (s?.opcoes ?? []).map((o) => `${o.principalId}+${o.apoioId ?? "-"}`);
}

function combinar(
  pessoas: PessoaDaBusca[],
  necessarios: 1 | 2,
  extra: {
    fixos?: { principalId?: string; apoioId?: string };
    tipo?: Partial<TipoDeAgendamento>;
  } = {},
): SlotComProfissionais[] {
  return combinacoesLivres({
    pessoas,
    necessarios,
    fixos: extra.fixos,
    tipo: { ...UMA_HORA, ...extra.tipo },
    ...SEGUNDA,
    agora: AGORA,
  });
}

describe("duas necessárias: o horário existe só com as DUAS livres", () => {
  it("ambas livres: cada horário traz a combinação principal + apoio", () => {
    const slots = combinar(
      [pessoa("ana", jornada("09:00", "12:00")), pessoa("bia", jornada("09:00", "12:00"))],
      2,
    );
    expect(horas(slots)).toEqual(["09:00", "10:00", "11:00"]);
    expect(opcoesDe(slots, "10:00")).toEqual(["ana+bia", "bia+ana"]);
  });

  it("apoio ocupada: o horário CAI quando não sobra ninguém para auxiliar", () => {
    const slots = combinar(
      [
        pessoa("ana", jornada("09:00", "12:00")),
        pessoa("bia", jornada("09:00", "12:00"), {
          ocupados: [{ inicio: sp("2026-03-09T10:00"), fim: sp("2026-03-09T11:00") }],
        }),
      ],
      2,
    );
    expect(horas(slots), "10:00 sem a Bia é procedimento sem auxiliar").toEqual(["09:00", "11:00"]);
  });

  it("os buffers do tipo valem para a APOIO também", () => {
    const bia = pessoa("bia", jornada("09:00", "12:00"), {
      ocupados: [{ inicio: sp("2026-03-09T11:00"), fim: sp("2026-03-09T11:30") }],
    });
    const semFolga = combinar([pessoa("ana", jornada("09:00", "12:00")), bia], 2, {
      fixos: { principalId: "ana" },
    });
    expect(horas(semFolga)).toEqual(["09:00", "10:00"]);

    const comFolga = combinar([pessoa("ana", jornada("09:00", "12:00")), bia], 2, {
      fixos: { principalId: "ana" },
      tipo: { bufferDepoisMin: 15 },
    });
    expect(
      horas(comFolga),
      "a limpeza depois das 10:00 invade o compromisso da Bia às 11:00",
    ).toEqual(["09:00"]);
  });

  it("apoio fora da grade da principal, mas DENTRO da própria jornada: atende", () => {
    // A jornada da Bia começa 09:15 — a grade DELA seria 09:15, 10:15… e
    // procurar 10:00 nela diria "não cabe" para um horário inteiro dentro do
    // expediente dela. A pergunta para a apoio é só "está livre?".
    const slots = combinar(
      [pessoa("ana", jornada("09:00", "12:00")), pessoa("bia", jornada("09:15", "12:00"))],
      2,
      { fixos: { principalId: "ana" } },
    );
    expect(horas(slots), "09:00 cai (a Bia ainda não chegou); 10:00 e 11:00 ficam").toEqual([
      "10:00",
      "11:00",
    ]);
  });

  it("apoio cuja jornada não contém o atendimento inteiro: não atende", () => {
    const slots = combinar(
      [pessoa("ana", jornada("09:00", "12:00")), pessoa("bia", jornada("09:00", "11:30"))],
      2,
      { fixos: { principalId: "ana" } },
    );
    expect(horas(slots)).toEqual(["09:00", "10:00"]);
  });

  it("principal fixa: só a grade DELA, com qualquer apoio", () => {
    const slots = combinar(
      [
        pessoa("ana", jornada("09:00", "11:00")),
        pessoa("bia", jornada("09:00", "18:00")),
        pessoa("cris", jornada("09:00", "18:00")),
      ],
      2,
      { fixos: { principalId: "ana" } },
    );
    expect(horas(slots)).toEqual(["09:00", "10:00"]);
    expect(opcoesDe(slots, "09:00")).toEqual(["ana+bia", "ana+cris"]);
  });

  it("principal E apoio fixas: uma combinação só", () => {
    const slots = combinar(
      [
        pessoa("ana", jornada("09:00", "11:00")),
        pessoa("bia", jornada("09:00", "18:00")),
        pessoa("cris", jornada("09:00", "18:00")),
      ],
      2,
      { fixos: { principalId: "ana", apoioId: "cris" } },
    );
    expect(opcoesDe(slots, "09:00")).toEqual(["ana+cris"]);
  });

  it("uma pessoa sozinha não forma par — e não vira a própria apoio", () => {
    expect(combinar([pessoa("ana", jornada("09:00", "12:00"))], 2)).toEqual([]);
  });
});

describe("uma necessária: a UNIÃO de qualquer habilitada", () => {
  it("o horário aparece uma vez, com quem pode atender, na ordem de `pessoas`", () => {
    const slots = combinar(
      [pessoa("ana", jornada("09:00", "11:00")), pessoa("bia", jornada("10:00", "12:00"))],
      1,
    );
    expect(horas(slots)).toEqual(["09:00", "10:00", "11:00"]);
    expect(opcoesDe(slots, "09:00")).toEqual(["ana+-"]);
    expect(
      opcoesDe(slots, "10:00"),
      "a ordem é a da operação: a 1ª opção é quem 'marcar sem escolher' pega",
    ).toEqual(["ana+-", "bia+-"]);
    expect(opcoesDe(slots, "11:00")).toEqual(["bia+-"]);
  });

  it("com uma pessoa só, é exatamente a grade de `horariosLivres`", () => {
    const ana = pessoa("ana", jornada("09:00", "18:00"), {
      ocupados: [{ inicio: sp("2026-03-09T13:00"), fim: sp("2026-03-09T14:00") }],
    });
    const sozinha = horariosLivres({ ...ana, tipo: UMA_HORA, ...SEGUNDA, agora: AGORA });
    const combinada = combinar([ana], 1);
    expect(combinada.map((s) => s.inicio.toISOString())).toEqual(
      sozinha.map((s) => s.inicio.toISOString()),
    );
  });

  it("principal fixa que não está entre as pessoas: nenhum horário", () => {
    expect(
      combinar([pessoa("ana", jornada("09:00", "12:00"))], 1, { fixos: { principalId: "zeca" } }),
    ).toEqual([]);
  });
});

describe("no salto do horário de verão, a união não reabre o horário duplicado", () => {
  it("dois instantes iguais viram um horário só, com as combinações sem repetição", () => {
    // Nova York, 2026-03-08: 02:00 desliza para 03:00 (decisão de `fuso.ts`).
    // Cada pessoa já deduplica a própria grade; a união de duas precisa
    // continuar com um horário por instante.
    const ny: JornadaDaAgenda = {
      timezone: "America/New_York",
      windows: [{ dow: 0, start: "01:00", end: "05:00" }],
    };
    const slots = combinacoesLivres({
      pessoas: [pessoa("ana", ny), pessoa("bia", ny)],
      necessarios: 2,
      tipo: UMA_HORA,
      de: new Date("2026-03-08T00:00:00Z"),
      ate: new Date("2026-03-09T12:00:00Z"),
      agora: AGORA,
    });
    const instantes = slots.map((s) => s.inicio.toISOString());
    expect(instantes).toEqual([
      "2026-03-08T06:00:00.000Z",
      "2026-03-08T07:00:00.000Z",
      "2026-03-08T08:00:00.000Z",
    ]);
    for (const s of slots) {
      const pares = s.opcoes.map((o) => `${o.principalId}+${o.apoioId}`);
      expect(new Set(pares).size, `${s.inicio.toISOString()} repetiu combinação`).toBe(
        pares.length,
      );
      expect(pares).toEqual(["ana+bia", "bia+ana"]);
    }
  });
});
