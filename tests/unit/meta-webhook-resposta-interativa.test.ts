import { describe, expect, it } from "vitest";

import { parseMetaWebhook, type InboundMessageEvent } from "@/lib/channels/meta/webhook";

/**
 * O toque numa opção no canal oficial. Antes disto, `interactive` e `button`
 * atravessavam o parser com o tipo cru, o insert violava `messages_type_check`
 * e a rota respondia 2xx — a resposta do cliente sumia sem erro na tela.
 *
 * ⚠️ Payloads montados a partir da documentação da Graph API (webhooks de
 * mensagens: `interactive.list_reply`, `interactive.button_reply`, `button`),
 * NÃO capturados de uma WABA real — diferente de `meta-webhook-inbound.test.ts`.
 * Quando houver captura, ela substitui estes.
 */

function envelope(mensagem: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba-1",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "5531000000000", phone_number_id: "pn-1" },
              contacts: [{ wa_id: "5531998966398", profile: { name: "Cliente" } }],
              messages: [
                { from: "5531998966398", id: "wamid.RESPOSTA", timestamp: "1760000000", ...mensagem },
              ],
            },
          },
        ],
      },
    ],
  } as Parameters<typeof parseMetaWebhook>[0];
}

const unico = (env: Parameters<typeof parseMetaWebhook>[0]) =>
  parseMetaWebhook(env).filter((e): e is InboundMessageEvent => e.kind === "inbound_message")[0];

describe("resposta interativa no canal oficial", () => {
  it("list_reply vira `text` com o título, o id da opção e a mensagem respondida", () => {
    const e = unico(
      envelope({
        type: "interactive",
        context: { from: "5531000000000", id: "wamid.LISTA" },
        interactive: { type: "list_reply", list_reply: { id: "o2", title: "Financeiro" } },
      }),
    );
    expect(e).toMatchObject({
      type: "text",
      text: "Financeiro",
      media: null,
      respostaInterativa: { formato: "lista", id: "o2", titulo: "Financeiro", respondida: "wamid.LISTA" },
    });
  });

  it("button_reply e botão de modelo também viram texto", () => {
    expect(
      unico(
        envelope({
          type: "interactive",
          interactive: { type: "button_reply", button_reply: { id: "sim", title: "Sim" } },
        }),
      ),
    ).toMatchObject({ type: "text", text: "Sim", respostaInterativa: { formato: "botao", id: "sim" } });

    expect(
      unico(envelope({ type: "button", button: { text: "Quero saber mais", payload: "MAIS" } })),
    ).toMatchObject({ type: "text", text: "Quero saber mais", respostaInterativa: { formato: "botao", id: "MAIS" } });
  });

  it("interactive de forma desconhecida segue o caminho comum, sem resposta inventada", () => {
    const e = unico(envelope({ type: "interactive", interactive: { type: "nfm_reply" } }));
    expect(e?.respostaInterativa).toBeUndefined();
  });
});
