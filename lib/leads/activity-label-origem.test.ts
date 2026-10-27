import { describe, expect, it } from "vitest";
import {
  activityLabel,
  LEAD_CRIADO_NO_KANBAN,
  LEAD_CRIADO_PELA_TAG,
} from "./activity-vocabulary";

/**
 * `lead_created` tem três portas e só uma é o WhatsApp. Medido em produção: o
 * negócio que a tag criou dizia "Entrou pelo WhatsApp" na linha do tempo.
 */
describe("activityLabel de lead_created conforme a origem", () => {
  it("a ingestão do canal continua dizendo WhatsApp", () => {
    expect(activityLabel("lead_created", { source_module: "canal.ingest" })).toBe("Entrou pelo WhatsApp");
  });

  it("linha antiga, sem origem, mantém o rótulo de sempre", () => {
    expect(activityLabel("lead_created")).toBe("Entrou pelo WhatsApp");
    expect(activityLabel("lead_created", null)).toBe("Entrou pelo WhatsApp");
  });

  it("criado pela tag ligada a uma coluna", () => {
    expect(
      activityLabel("lead_created", { source_module: "crm", payload: { tag: "Quer agendar" } }),
    ).toBe(LEAD_CRIADO_PELA_TAG);
  });

  it("colocado no Kanban pela conversa", () => {
    expect(
      activityLabel("lead_created", { source_module: "crm", payload: { stage_id: "x" } }),
    ).toBe(LEAD_CRIADO_NO_KANBAN);
  });

  it("a origem não mexe nos outros tipos", () => {
    expect(activityLabel("stage_changed", { source_module: "crm" })).toBe("Mudou de estágio");
  });
});
