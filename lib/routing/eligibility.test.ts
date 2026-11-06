import { describe, expect, it } from "vitest";

import {
  HEARTBEAT_TIMEOUT_MINUTES,
  isAttendantEligible,
  isHeartbeatStale,
  isWithinSchedule,
  nextScheduleOpening,
} from "./eligibility";
import { availabilityScheduleSchema } from "@/lib/schemas/routing";

/**
 * Elegibilidade (spec 13 §5) + heartbeat AT-08. Clock SEMPRE injetado (`now`) —
 * zero relógio implícito, zero sleep real; o "agora" é um parâmetro.
 */

// Seg 2026-07-13 14:00 America/Sao_Paulo (UTC-03) == 17:00Z. dow=1 (segunda).
const MON_1400_BRT = new Date("2026-07-13T17:00:00Z");
// Seg 2026-07-13 19:00 BRT == 22:00Z (fora de uma janela 08:00–18:00).
const MON_1900_BRT = new Date("2026-07-13T22:00:00Z");

const schedule8to18Mon = availabilityScheduleSchema.parse({
  timezone: "America/Sao_Paulo",
  windows: [{ dow: 1, start: "08:00", end: "18:00" }],
});

describe("isWithinSchedule (tz-aware)", () => {
  it("dentro da janela (seg 14:00 BRT, janela seg 08–18) ⇒ true", () => {
    expect(isWithinSchedule(schedule8to18Mon, MON_1400_BRT)).toBe(true);
  });

  it("fora da janela (seg 19:00 BRT, janela seg 08–18) ⇒ false", () => {
    expect(isWithinSchedule(schedule8to18Mon, MON_1900_BRT)).toBe(false);
  });

  it("dia sem janela (mesma hora mas janela só seg — testado terça) ⇒ false", () => {
    // Ter 2026-07-14 14:00 BRT == 17:00Z, dow=2 — sem janela ⇒ inelegível.
    const tue1400 = new Date("2026-07-14T17:00:00Z");
    expect(isWithinSchedule(schedule8to18Mon, tue1400)).toBe(false);
  });

  it("windows vazio (default '{}') ⇒ sem restrição (24/7) ⇒ true", () => {
    expect(isWithinSchedule({ timezone: "America/Sao_Paulo", windows: [] }, MON_1900_BRT)).toBe(
      true,
    );
  });
});

describe("isAttendantEligible (§5: disponível ∧ horário ∧ folga)", () => {
  const base = { isAvailable: true, capacity: 5, currentLoad: 2, schedule: schedule8to18Mon };

  it("disponível + dentro da janela + com folga (2/5) ⇒ elegível", () => {
    expect(isAttendantEligible(base, MON_1400_BRT)).toBe(true);
  });

  it("fora da janela (seg 19h) ⇒ NÃO elegível", () => {
    expect(isAttendantEligible(base, MON_1900_BRT)).toBe(false);
  });

  it("capacidade cheia (carga 5 == capacity 5) ⇒ NÃO elegível", () => {
    expect(isAttendantEligible({ ...base, currentLoad: 5 }, MON_1400_BRT)).toBe(false);
  });

  it("carga acima da capacidade (6 > 5) ⇒ NÃO elegível", () => {
    expect(isAttendantEligible({ ...base, currentLoad: 6 }, MON_1400_BRT)).toBe(false);
  });

  it("offline (is_available=false), mesmo com folga e no horário ⇒ NÃO elegível", () => {
    expect(isAttendantEligible({ ...base, isAvailable: false }, MON_1400_BRT)).toBe(false);
  });
});

describe("isHeartbeatStale (AT-08 auto-offline, clock mockado)", () => {
  const now = new Date("2026-07-13T17:00:00Z");

  it(`heartbeat há ${HEARTBEAT_TIMEOUT_MINUTES}min exatos ⇒ ainda vivo (não-estrito)`, () => {
    const at = new Date(now.getTime() - HEARTBEAT_TIMEOUT_MINUTES * 60_000).toISOString();
    expect(isHeartbeatStale(at, now)).toBe(false);
  });

  it("heartbeat há 16min ⇒ velho ⇒ auto-offline", () => {
    const at = new Date(now.getTime() - 16 * 60_000).toISOString();
    expect(isHeartbeatStale(at, now)).toBe(true);
  });

  it("heartbeat há 14min ⇒ ainda vivo", () => {
    const at = new Date(now.getTime() - 14 * 60_000).toISOString();
    expect(isHeartbeatStale(at, now)).toBe(false);
  });

  it("sem heartbeat (null) ⇒ velho ⇒ auto-offline", () => {
    expect(isHeartbeatStale(null, now)).toBe(true);
  });
});

/**
 * A jornada que derrubou o rodízio em produção (America/Belem, UTC-03, sem
 * horário de verão): seg–sex 08–12 e 14–18, sáb 08–12. Fora dela o evento
 * morria em 5 min; agora ele volta na abertura.
 */
describe("nextScheduleOpening", () => {
  const jornada = availabilityScheduleSchema.parse({
    timezone: "America/Belem",
    windows: [
      ...[1, 2, 3, 4, 5].flatMap((dow) => [
        { dow, start: "08:00", end: "12:00" },
        { dow, start: "14:00", end: "18:00" },
      ]),
      { dow: 6, start: "08:00", end: "12:00" },
    ],
  });

  it("no almoço (ter 12:32) ⇒ abre às 14:00 do mesmo dia", () => {
    // Ter 2026-10-27 12:32:40 Belém == 15:32:40Z.
    const abre = nextScheduleOpening(jornada, new Date("2026-10-27T15:32:40Z"));
    expect(abre?.toISOString()).toBe("2026-10-27T17:00:40.000Z");
    expect(isWithinSchedule(jornada, abre!)).toBe(true);
  });

  it("à noite (ter 22:10) ⇒ abre às 08:00 de quarta", () => {
    const abre = nextScheduleOpening(jornada, new Date("2026-10-28T01:10:00Z"));
    expect(abre?.toISOString()).toBe("2026-10-28T11:00:00.000Z");
  });

  it("sábado depois do meio-dia ⇒ só segunda às 08:00 (domingo não tem janela)", () => {
    // Sáb 2026-10-31 12:00 Belém == 15:00Z — fim exclusivo, já fora.
    const abre = nextScheduleOpening(jornada, new Date("2026-10-31T15:00:00Z"));
    expect(abre?.toISOString()).toBe("2026-11-02T11:00:00.000Z");
  });

  it("dentro da janela ⇒ agora", () => {
    const agora = new Date("2026-10-27T14:00:00Z"); // ter 11:00 Belém
    expect(nextScheduleOpening(jornada, agora)).toBe(agora);
  });

  it("sem janelas (24/7) ⇒ null: não há abertura a esperar", () => {
    expect(nextScheduleOpening(availabilityScheduleSchema.parse({}), new Date())).toBeNull();
  });

  it("janela que abre daqui a 1 semana menos 1 minuto (passou 1 min do início e já fechou)", () => {
    const so = availabilityScheduleSchema.parse({
      timezone: "America/Sao_Paulo",
      windows: [{ dow: 1, start: "08:00", end: "08:01" }],
    });
    // Seg 2026-07-13 08:01 BRT == 11:01Z — janela [08:00, 08:01) acabou.
    const abre = nextScheduleOpening(so, new Date("2026-07-13T11:01:00Z"));
    expect(abre?.toISOString()).toBe("2026-07-20T11:00:00.000Z");
  });
});
