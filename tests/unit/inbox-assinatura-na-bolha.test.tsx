/**
 * A assinatura do atendente na bolha: `*Maria:*\ntexto` gravado vira "Maria:"
 * em negrito, sem os asteriscos — como o WhatsApp desenha para o cliente.
 *
 * A asserção que carrega o arquivo é a negativa: o CLIENTE que escreve
 * `*Promo:*` na primeira linha não está assinando, e a bolha dele fica literal.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { MessageBubble } from "@/components/inbox/MessageBubble";
import type { Message } from "@/lib/types/messaging";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (texto: string) => texto }));
vi.mock("@/hooks/i18n/useLocaleDeData", () => ({
  useLocaleDeData: () => undefined,
  useTagDeIdioma: () => "pt-BR",
}));

afterEach(cleanup);

const mensagem = (over: Partial<Message> = {}): Message =>
  ({
    id: "m1",
    organization_id: "org",
    conversation_id: "c1",
    channel_session_id: "s1",
    contact_id: "ct1",
    type: "text",
    direction: "outbound",
    status: "sent",
    body: "*Maria:*\nSeu pedido saiu.",
    sent_via: "user",
    sent_at: new Date("2026-09-01T12:00:00Z").toISOString(),
    metadata: {},
    ...over,
  }) as unknown as Message;

describe("assinatura na bolha", () => {
  it("mensagem nossa assinada mostra o nome em negrito, sem asteriscos", () => {
    const { container } = render(<MessageBubble message={mensagem()} />);
    const nome = container.querySelector("[data-assinatura]");
    expect(nome?.textContent).toBe("Maria:");
    expect(nome).toHaveClass("font-semibold");
    expect(container.textContent).toContain("Seu pedido saiu.");
    expect(container.textContent).not.toContain("*Maria:*");
  });

  it("mensagem do cliente com o mesmo formato fica literal", () => {
    const { container } = render(
      <MessageBubble message={mensagem({ direction: "inbound", body: "*Promo:*\nhoje" })} />,
    );
    expect(container.querySelector("[data-assinatura]")).toBeNull();
    expect(container.textContent).toContain("*Promo:*");
  });

  it("mensagem sem assinatura não ganha marcação", () => {
    const { container } = render(<MessageBubble message={mensagem({ body: "Oi" })} />);
    expect(container.querySelector("[data-assinatura]")).toBeNull();
  });
});
