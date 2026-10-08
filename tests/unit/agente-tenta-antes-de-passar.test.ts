/**
 * QUANDO O CLIENTE PEDE UMA PESSOA (migration 0227).
 *
 * Padrão: passa na hora, como sempre. Com `tentarAntes`, o agente ganha UMA
 * chance — e a passagem por insistência é decidida aqui, no código, para não
 * depender de o modelo obedecer a uma instrução.
 */
import { describe, expect, it } from "vitest";

import { decidirPedidoDeHumano } from "@/lib/agent-engine/agent/human-handoff";
import type { LeadContextMessage } from "@/lib/agent-engine/edge/crm/get-lead-context";

const entra = (body: string): LeadContextMessage => ({ direction: "inbound", body, sent_at: "2026-10-07T12:00:00Z" });
const sai = (body: string): LeadContextMessage => ({ direction: "outbound", body, sent_at: "2026-10-07T12:00:01Z" });

const base = { palavras: [] as string[], tentarAntes: true, ferramentaLigada: true };

describe("decidirPedidoDeHumano", () => {
  it("sem pedido → nada", () => {
    expect(decidirPedidoDeHumano({ ...base, mensagens: [entra("meu relatório não abre")] })).toBe("nada");
  });

  it("padrão (tentarAntes desligado) → escala na hora, como sempre", () => {
    expect(
      decidirPedidoDeHumano({ ...base, tentarAntes: false, mensagens: [entra("quero falar com um atendente")] }),
    ).toBe("escalar_agora");
  });

  it("primeiro pedido com tentarAntes → uma chance", () => {
    expect(decidirPedidoDeHumano({ ...base, mensagens: [entra("oi"), sai("Olá!"), entra("quero falar com um atendente")] })).toBe(
      "tentar_uma_vez",
    );
  });

  it("insistiu depois da nossa resposta → escala, sem depender do modelo", () => {
    const mensagens = [
      entra("quero falar com um atendente"),
      sai("Consigo te ajudar agora: abra Configurações > Integrações…"),
      entra("não, quero falar com uma pessoa"),
    ];
    expect(decidirPedidoDeHumano({ ...base, mensagens })).toBe("escalar_agora");
  });

  it("rajada antes de qualquer resposta ainda é o primeiro pedido", () => {
    const mensagens = [entra("quero falar com um atendente"), entra("falar com atendente por favor")];
    expect(decidirPedidoDeHumano({ ...base, mensagens })).toBe("tentar_uma_vez");
  });

  it("sem a ferramenta de passagem o modelo não teria como passar depois → escala na hora", () => {
    expect(
      decidirPedidoDeHumano({ ...base, ferramentaLigada: false, mensagens: [entra("quero falar com um atendente")] }),
    ).toBe("escalar_agora");
  });

  it("palavra-chave do agente também é pedido", () => {
    expect(decidirPedidoDeHumano({ ...base, palavras: ["suporte humano"], mensagens: [entra("Suporte humano")] })).toBe(
      "tentar_uma_vez",
    );
  });

  it("pedido antigo que não é o último não conta como pedido agora", () => {
    const mensagens = [entra("quero falar com um atendente"), sai("Claro, me diga o problema"), entra("o relatório não abre")];
    expect(decidirPedidoDeHumano({ ...base, mensagens })).toBe("nada");
  });
});
