"use client";

import { useT } from "@/hooks/i18n/useT";

import { Aviso } from "./shared";

/** `trigger.ai_handoff` — sem ajustes: quem dispara é a passagem da IA para uma pessoa. */
export function TriggerAiHandoffForm() {
  const t = useT();
  return (
    <Aviso
      texto={t(
        "Este fluxo começa sozinho toda vez que o agente de IA passa uma conversa para uma pessoa. Use {{contact.name}}, {{contact.phone_number}}, {{event.reason}} e {{event.summary}} na mensagem.",
      )}
    />
  );
}
