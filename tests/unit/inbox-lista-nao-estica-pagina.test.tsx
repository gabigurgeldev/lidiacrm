import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

/**
 * A lista do inbox NÃO pode esticar a página.
 *
 * O selo do canal na linha (`TipoDeCanal variante="bolha"`) leva um
 * `<span class="sr-only">`, que é `position: absolute`. Sem ancestral
 * posicionado, o bloco de contenção dele é a página inteira: o span de cada
 * linha — inclusive as que a lista rolável esconde — alongava o documento,
 * a JANELA rolava, a casca subia e sobrava meia tela branca embaixo.
 * `overflow-hidden` no caminho não segura absoluto sem `relative`.
 */
import { ConversationListItem } from "@/components/inbox/ConversationListItem";
import type { ConversationWithContact } from "@/hooks/inbox/useConversationsRealtime";

const conv = {
  id: "c1",
  organization_id: "org",
  contact_id: "ct1",
  channel_session_id: "s1",
  channel: "whatsapp",
  status: "open",
  last_message_at: new Date().toISOString(),
  last_message_preview: "olá",
  unread_count_for_assignee: 0,
  created_at: new Date().toISOString(),
  contacts: { id: "ct1", display_name: "Cliente", name: null, phone_number: "+595999", tags: [], is_blocked: false, is_anonymized: false },
  channel_sessions: { phone_number: "+19392301037", display_name: "MP wp", provider: "waha" },
} as unknown as ConversationWithContact;

describe("linha da lista do inbox", () => {
  it("todo texto sr-only tem ancestral posicionado DENTRO da linha", () => {
    const { container } = render(
      <ConversationListItem conversation={conv} isSelected={false} onSelect={() => {}} mostrarCanal />,
    );
    const linha = container.querySelector("[data-conversation-id]");
    const escondidos = Array.from(container.querySelectorAll(".sr-only"));
    expect(escondidos.length).toBeGreaterThan(0);

    for (const span of escondidos) {
      let pai = span.parentElement;
      let achou = false;
      while (pai && pai !== container) {
        if (/(^|\s)(relative|absolute|fixed|sticky)(\s|$)/.test(pai.className)) {
          achou = true;
          break;
        }
        pai = pai.parentElement;
      }
      expect(achou, "sr-only sem ancestral posicionado vaza para a página").toBe(true);
      expect(linha?.contains(pai ?? null)).toBe(true);
    }
  });
});
