/**
 * O aviso ao dono chegava como um bloco corrido: o agente grava o motivo da
 * passagem numa linha com campos separados por `|`, e o fluxo interpolava isso
 * cru no WhatsApp (Açaí Delícia, 2026-10-08). `{{event.reason_em_linhas}}` é a
 * mesma informação, uma por linha.
 */
import { describe, expect, it } from "vitest";

import { motivoEmLinhas, payloadDoAnuncio } from "@/lib/escalacao/anuncio-da-passagem";

const MOTIVO_REAL =
  "PEDIDO CONFIRMADO | Nome: Gabriel Gurgel | Tel: +55 94 98100-4900 | Itens: 3L açaí (R$54,00); farinha de puba 1L (R$12,99) | Receber: 99 Entrega (cliente chama) - Rua Quinze, lote 15 | Pagamento: Pix (chave 94992128477) | Total: R$66,99 | Obs: cliente confirmou resumo com \"Sim\"";

describe("motivo da passagem em linhas", () => {
  it("quebra o pedido em linhas, com rótulo em negrito e itens em lista", () => {
    expect(motivoEmLinhas(MOTIVO_REAL)).toBe(
      [
        "*PEDIDO CONFIRMADO*",
        "*Nome:* Gabriel Gurgel",
        "*Tel:* +55 94 98100-4900",
        "*Itens:*",
        "• 3L açaí (R$54,00)",
        "• farinha de puba 1L (R$12,99)",
        "*Receber:* 99 Entrega (cliente chama) - Rua Quinze, lote 15",
        "*Pagamento:* Pix (chave 94992128477)",
        "*Total:* R$66,99",
        '*Obs:* cliente confirmou resumo com "Sim"',
      ].join("\n"),
    );
  });

  it("`;` dentro de parênteses não vira lista", () => {
    expect(motivoEmLinhas("PEDIDO CONFIRMADO | Pagamento: Pix (manda o comprovante; chave 94992128477)")).toBe(
      "*PEDIDO CONFIRMADO*\n*Pagamento:* Pix (manda o comprovante; chave 94992128477)",
    );
  });

  it("motivo em texto livre (sem `|`) volta como veio", () => {
    expect(motivoEmLinhas("cliente pediu para falar com uma pessoa")).toBe(
      "cliente pediu para falar com uma pessoa",
    );
    expect(motivoEmLinhas("requested_human")).toBe("requested_human");
  });

  it("o evento leva as duas formas: `reason` intacto e `reason_em_linhas`", () => {
    const p = payloadDoAnuncio({
      contactId: "c",
      conversationId: "v",
      leadId: null,
      reason: MOTIVO_REAL,
      summary: "s",
      leadAvisado: true,
    });
    expect(p.reason).toBe(MOTIVO_REAL);
    expect(String(p.reason_em_linhas)).toContain("\n*Total:* R$66,99");
  });
});
