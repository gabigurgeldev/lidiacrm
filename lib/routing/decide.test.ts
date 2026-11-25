import { describe, expect, it } from "vitest";

import {
  decideRouting,
  ESPERA_NA_FILA_SEGUNDOS,
  selectRoundRobin,
  type RoutingCandidate,
} from "./decide";
import { routingConfigSchema } from "@/lib/schemas/routing";

/**
 * Decisão PURA do worker de roteamento (G5-02 — AT-03). Cobre os 5 cenários do
 * acceptance na camada de lógica; a garantia transacional (trigger emite, fn
 * atribui atomicamente + idempotência DB) fica no invariante SQL
 * tests/invariants/gov-4b-routing-worker.test.ts. Clock SEMPRE injetado.
 */

const NOW = new Date("2026-07-13T17:00:00Z");
const config = routingConfigSchema.parse({ mode: "round_robin", max_retries: 5, backoff_seconds: 60 });

const cand = (userId: string, lastAssignedAt: number | null, currentLoad = 0): RoutingCandidate => ({
  userId,
  currentLoad,
  lastAssignedAt,
});

describe("selectRoundRobin (rodízio real)", () => {
  it("nenhum elegível ⇒ null", () => {
    expect(selectRoundRobin([])).toBeNull();
  });

  it("nunca-atribuído (null) tem prioridade sobre quem já recebeu", () => {
    const picked = selectRoundRobin([cand("b", 1000), cand("a", null)]);
    expect(picked).toBe("a");
  });

  it("entre atribuídos, o mais ANTIGO vem primeiro (rodízio)", () => {
    const picked = selectRoundRobin([cand("recent", 5000), cand("old", 1000)]);
    expect(picked).toBe("old");
  });

  it("empate determinístico por userId", () => {
    expect(selectRoundRobin([cand("z", null), cand("a", null)])).toBe("a");
  });
});

describe("decideRouting — os 5 cenários do acceptance", () => {
  it("round_robin com elegível ⇒ assign ao elegível (nunca ao inelegível — já filtrado)", () => {
    const action = decideRouting({
      mode: "round_robin",
      alreadyAssigned: false,
      eligibles: [cand("agent-eligible", null)],
      config,
      attempts: 0,
      now: NOW,
    });
    expect(action).toEqual({ kind: "assign", userId: "agent-eligible" });
  });

  it("idempotência: conversa que JÁ tem dono ⇒ skip, nunca reatribui (acceptance 3)", () => {
    const action = decideRouting({
      mode: "round_robin",
      alreadyAssigned: true,
      eligibles: [cand("someone", null)],
      config,
      attempts: 0,
      now: NOW,
    });
    expect(action).toEqual({ kind: "skip", reason: "already_assigned" });
  });

  it("sem elegível ⇒ requeue com backoff futuro + attempts++ (acceptance 4)", () => {
    const action = decideRouting({
      mode: "round_robin",
      alreadyAssigned: false,
      eligibles: [],
      config,
      attempts: 2,
      now: NOW,
    });
    expect(action.kind).toBe("requeue");
    if (action.kind === "requeue") {
      expect(action.attempts).toBe(3);
      // backoff_seconds=60 ⇒ next_attempt_at = now + 60s.
      expect(new Date(action.nextAttemptAt).getTime()).toBe(NOW.getTime() + 60_000);
      expect(new Date(action.nextAttemptAt).getTime()).toBeGreaterThan(NOW.getTime());
    }
  });

  it("sem elegível após estourar max_retries ⇒ segue na fila, conferindo a cada 10 min (nunca desiste)", () => {
    const action = decideRouting({
      mode: "round_robin",
      alreadyAssigned: false,
      eligibles: [],
      config, // max_retries=5
      attempts: 5,
      now: NOW,
    });
    expect(action).toEqual({
      kind: "requeue",
      nextAttemptAt: new Date(NOW.getTime() + ESPERA_NA_FILA_SEGUNDOS * 1000).toISOString(),
      attempts: 6,
      naFila: true,
    });
  });

  it("modo manual ⇒ skip, worker não atribui (acceptance 5)", () => {
    const action = decideRouting({
      mode: "manual",
      alreadyAssigned: false,
      eligibles: [cand("agent", null)],
      config: routingConfigSchema.parse({ mode: "manual" }),
      attempts: 0,
      now: NOW,
    });
    expect(action).toEqual({ kind: "skip", reason: "manual_mode" });
  });

  it("modo 'load' (inalcançável no schema) ⇒ skip defensivo, no-op", () => {
    const action = decideRouting({
      mode: "load",
      alreadyAssigned: false,
      eligibles: [cand("agent", null)],
      config,
      attempts: 0,
      now: NOW,
    });
    expect(action).toEqual({ kind: "skip", reason: "unsupported_mode:load" });
  });
});

describe("decideRouting — fora do horário não é tentativa", () => {
  it("sem elegível e com abertura marcada ⇒ volta NA abertura e não gasta tentativa", () => {
    const abre = new Date(NOW.getTime() + 90 * 60_000);
    const action = decideRouting({
      mode: "round_robin",
      alreadyAssigned: false,
      eligibles: [],
      config,
      attempts: 5, // já no teto: pelo caminho antigo, morreria aqui
      now: NOW,
      nextOpeningAt: abre,
    });
    expect(action).toEqual({
      kind: "requeue",
      nextAttemptAt: abre.toISOString(),
      attempts: 5,
      aguardandoHorario: true,
    });
  });

  it("abertura nula (todo mundo lotado ou offline) ⇒ caminho antigo, que agora termina na fila lenta", () => {
    const action = decideRouting({
      mode: "round_robin",
      alreadyAssigned: false,
      eligibles: [],
      config,
      attempts: 5,
      now: NOW,
      nextOpeningAt: null,
    });
    expect(action).toMatchObject({ kind: "requeue", naFila: true, attempts: 6 });
  });

  it("abertura no passado não vira espera (defesa contra relógio torto)", () => {
    const action = decideRouting({
      mode: "round_robin",
      alreadyAssigned: false,
      eligibles: [],
      config,
      attempts: 0,
      now: NOW,
      nextOpeningAt: new Date(NOW.getTime() - 1000),
    });
    expect(action).toEqual({
      kind: "requeue",
      nextAttemptAt: new Date(NOW.getTime() + 60_000).toISOString(),
      attempts: 1,
    });
  });

  it("com elegível, a abertura é irrelevante ⇒ atribui", () => {
    const action = decideRouting({
      mode: "round_robin",
      alreadyAssigned: false,
      eligibles: [cand("a", null)],
      config,
      attempts: 0,
      now: NOW,
      nextOpeningAt: new Date(NOW.getTime() + 60_000),
    });
    expect(action).toEqual({ kind: "assign", userId: "a" });
  });
});

/**
 * O evento sem elegível NÃO morre mais (incidente Faby Flores, 2026-11-25: 248
 * eventos mortos, 214 conversas sem dono para sempre, invisíveis às atendentes
 * no modo "só as minhas"). Estes casos travam as três propriedades da fila
 * lenta: não existe saída `dead`, o ritmo respeita o `backoff_seconds` de quem
 * pediu calma, e a conversa é entregue assim que alguém volta.
 */
describe("decideRouting — a conversa sem dono nunca é abandonada", () => {
  it("nenhum número de tentativas produz `dead`", () => {
    for (const attempts of [0, 4, 5, 6, 20, 500, 10_000]) {
      const action = decideRouting({
        mode: "round_robin",
        alreadyAssigned: false,
        eligibles: [],
        config,
        attempts,
        now: NOW,
      });
      expect(action.kind).toBe("requeue");
    }
  });

  it("max_retries = 0 vai direto para a fila lenta", () => {
    const action = decideRouting({
      mode: "round_robin",
      alreadyAssigned: false,
      eligibles: [],
      config: routingConfigSchema.parse({ mode: "round_robin", max_retries: 0 }),
      attempts: 0,
      now: NOW,
    });
    expect(action).toMatchObject({ kind: "requeue", naFila: true, attempts: 1 });
  });

  it("backoff configurado MAIOR que 10 min manda no ritmo da fila lenta", () => {
    const action = decideRouting({
      mode: "round_robin",
      alreadyAssigned: false,
      eligibles: [],
      config: routingConfigSchema.parse({ mode: "round_robin", max_retries: 2, backoff_seconds: 1800 }),
      attempts: 2,
      now: NOW,
    });
    expect(action).toMatchObject({ kind: "requeue", naFila: true });
    if (action.kind === "requeue") {
      expect(new Date(action.nextAttemptAt).getTime()).toBe(NOW.getTime() + 1800 * 1000);
    }
  });

  it("na fila lenta há dias, alguém volta ⇒ atribui na hora", () => {
    const action = decideRouting({
      mode: "round_robin",
      alreadyAssigned: false,
      eligibles: [cand("voltou", null)],
      config,
      attempts: 300,
      now: NOW,
    });
    expect(action).toEqual({ kind: "assign", userId: "voltou" });
  });

  it("fora do horário continua com hora marcada, sem cair na fila lenta", () => {
    const abre = new Date(NOW.getTime() + 3 * 3600_000);
    const action = decideRouting({
      mode: "round_robin",
      alreadyAssigned: false,
      eligibles: [],
      config,
      attempts: 40,
      now: NOW,
      nextOpeningAt: abre,
    });
    expect(action).toEqual({
      kind: "requeue",
      nextAttemptAt: abre.toISOString(),
      attempts: 40,
      aguardandoHorario: true,
    });
  });
});
