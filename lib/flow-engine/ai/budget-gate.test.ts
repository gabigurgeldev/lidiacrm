import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BudgetStatus } from "@/lib/ai/budget/check";

/**
 * O TESTE QUE PROVA O MAPEAMENTO DE CAMPOS, NÃO A REGRA.
 *
 * `decidirOrcamento` (lib/agent-engine/edge/llm/orcamento.ts) já tem os
 * próprios testes para a árvore de decisão inteira — este arquivo não a
 * repete. O risco que ESTE teste cobre é outro: `orcamentoPermite` traduz
 * `BudgetStatus` (o shape de `getBudgetStatus`) para `EntradaDeOrcamento` (o
 * shape que `decidirOrcamento` espera) à mão, campo a campo. Um nome trocado
 * nessa tradução — `enforcement_mode` lido onde devia ser
 * `current_month_consumed_cents`, por exemplo — faria o gate SEMPRE liberar
 * ou SEMPRE bloquear, e nenhum teste da função pura acusaria isso: ela
 * receberia o valor errado e decidiria CORRETAMENTE em cima do dado ERRADO.
 */
const getBudgetStatusMock = vi.fn();
vi.mock("@/lib/ai/budget/check", () => ({ getBudgetStatus: (...args: unknown[]) => getBudgetStatusMock(...args) }));

function statusBase(overrides: Partial<BudgetStatus> = {}): BudgetStatus {
  return {
    organization_id: "org-1",
    monthly_limit_cents: 10_000,
    current_month_consumed_cents: 0,
    pct: 0,
    alarm_threshold_pct: 80,
    enforcement_mode: "off",
    enforcement_effective_at: null,
    ha_custo_desconhecido: false,
    ...overrides,
  } as BudgetStatus;
}

describe("orcamentoPermite", () => {
  beforeEach(() => {
    getBudgetStatusMock.mockReset();
    vi.resetModules();
  });

  it("modo 'off': sempre permite, mesmo com gasto acima do teto", async () => {
    getBudgetStatusMock.mockResolvedValue(
      statusBase({ enforcement_mode: "off", monthly_limit_cents: 100, current_month_consumed_cents: 999 }),
    );
    const { orcamentoPermite } = await import("./budget-gate");
    expect((await orcamentoPermite("org-1", "flow_ai_gerar")).permitido).toBe(true);
  });

  it("modo 'bloquear' com gasto abaixo do teto: permite", async () => {
    getBudgetStatusMock.mockResolvedValue(
      statusBase({
        enforcement_mode: "bloquear",
        monthly_limit_cents: 10_000,
        current_month_consumed_cents: 100,
      }),
    );
    const { orcamentoPermite } = await import("./budget-gate");
    expect((await orcamentoPermite("org-1", "flow_ai_gerar")).permitido).toBe(true);
  });

  it("modo 'bloquear' com gasto NO teto: recusa com frase acionável", async () => {
    getBudgetStatusMock.mockResolvedValue(
      statusBase({
        enforcement_mode: "bloquear",
        monthly_limit_cents: 10_000,
        current_month_consumed_cents: 10_000,
        enforcement_effective_at: new Date(Date.now() - 60_000).toISOString(),
      }),
    );
    const { orcamentoPermite } = await import("./budget-gate");
    const v = await orcamentoPermite("org-1", "flow_ai_gerar");
    expect(v.permitido).toBe(false);
    expect(v.motivo).toMatch(/orçamento/i);
  });

  it("modo 'avisar' com gasto no teto: permite (avisa, não bloqueia)", async () => {
    getBudgetStatusMock.mockResolvedValue(
      statusBase({
        enforcement_mode: "avisar",
        monthly_limit_cents: 10_000,
        current_month_consumed_cents: 10_000,
      }),
    );
    const { orcamentoPermite } = await import("./budget-gate");
    expect((await orcamentoPermite("org-1", "flow_ai_gerar")).permitido).toBe(true);
  });

  it("teto zerado/sem valor útil: não vincula ninguém, mesmo em modo bloquear", async () => {
    getBudgetStatusMock.mockResolvedValue(
      statusBase({ enforcement_mode: "bloquear", monthly_limit_cents: 0, current_month_consumed_cents: 0 }),
    );
    const { orcamentoPermite } = await import("./budget-gate");
    expect((await orcamentoPermite("org-1", "flow_ai_gerar")).permitido).toBe(true);
  });

  it("repassa organizationId para getBudgetStatus — nunca lê org de outro lugar", async () => {
    getBudgetStatusMock.mockResolvedValue(statusBase());
    const { orcamentoPermite } = await import("./budget-gate");
    await orcamentoPermite("org-especifica", "flow_ai_interpretar");
    expect(getBudgetStatusMock).toHaveBeenCalledWith("org-especifica");
  });
});
