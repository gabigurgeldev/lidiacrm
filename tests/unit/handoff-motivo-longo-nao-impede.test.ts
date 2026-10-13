import { describe, expect, it } from "vitest";

import {
  cortarMotivo,
  LIMITE_DO_MOTIVO,
  requestHumanHandoffInputSchema,
} from "@/lib/agent-engine/agent/human-handoff";

/**
 * Motivo comprido não pode impedir a passagem para pessoa.
 *
 * Caso Faby (2026-10-13): o agente avisou o cliente "vou passar para uma
 * atendente", mandou o pedido inteiro no `reason` (600+ caracteres), a
 * ferramenta respondeu `too_big`, o turno acabou e ninguém assumiu.
 */

const PEDIDO =
  "PRONTO PARA FECHAR | Ocasião: Dia das Crianças, presente para si mesmo | Para quem: Gabriel | " +
  "Produto: buquê 4 rosas | Orçamento: R$ 80 a R$ 150 | Entrega: hoje 13/10 por volta das 16h30 " +
  "(valor e horário a confirmar: Portão Cinza pode ficar fora da entrega padrão) | Endereço: bairro dos " +
  "Minérios, Rua 15, quadra 45, lote 12, Portão Cinza | Recebe: Gabriel | Cartão: não | Pagamento: Pix | " +
  "Observação: cliente confirmou o resumo com sim e quer saber o valor final com a entrega antes de pagar | Urgência: alta, entrega no mesmo dia";

describe("motivo da passagem", () => {
  it("motivo maior que o limite é aceito e cortado, não recusado", () => {
    expect(PEDIDO.length).toBeGreaterThan(LIMITE_DO_MOTIVO);
    const r = requestHumanHandoffInputSchema.safeParse({ reason: PEDIDO });
    expect(r.success).toBe(true);
    expect(r.success && r.data.reason!.length).toBeLessThanOrEqual(LIMITE_DO_MOTIVO);
  });

  it("corta na última fronteira de campo e marca o corte", () => {
    const cortado = cortarMotivo(PEDIDO);
    expect(cortado.endsWith("…")).toBe(true);
    // Termina num campo inteiro: o pedaço antes do "…" é um prefixo que acaba antes de um "|".
    const semMarca = cortado.slice(0, -1);
    expect(PEDIDO.startsWith(semMarca)).toBe(true);
    expect(PEDIDO.slice(semMarca.length).trimStart().startsWith("|")).toBe(true);
  });

  it("motivo dentro do limite passa intacto", () => {
    expect(cortarMotivo("CLIENTE PEDIU ATENDENTE")).toBe("CLIENTE PEDIU ATENDENTE");
  });

  it("sem fronteira útil, corta seco no limite", () => {
    const corrido = "a".repeat(800);
    const cortado = cortarMotivo(corrido);
    expect(cortado.length).toBe(LIMITE_DO_MOTIVO);
    expect(cortado.endsWith("…")).toBe(true);
  });

  it("campo extra segue recusado (whitelist estrita)", () => {
    expect(requestHumanHandoffInputSchema.safeParse({ reason: "x", lead_id: "y" }).success).toBe(false);
  });
});
