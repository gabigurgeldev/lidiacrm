"use client";

import { useT } from "@/hooks/i18n/useT";

import { Aviso } from "./shared";

/**
 * `trigger.conversation_routed` — sem ajustes: quem dispara é o rodízio
 * automático entregando uma conversa a alguém da equipe.
 */
export function TriggerConversationRoutedForm() {
  const t = useT();
  return (
    <Aviso
      texto={t(
        "Este fluxo começa sozinho toda vez que o sistema distribui uma conversa para alguém da equipe. Ligue um bloco \"Avisar o vendedor no WhatsApp\" com o destinatário \"Dono do lead\" para avisar quem recebeu. Use {{contact.name}}, {{contact.phone_number}} e {{lead.title}} na mensagem.",
      )}
    />
  );
}
