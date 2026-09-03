"use client";

import { useT } from "@/hooks/i18n/useT";

import { Aviso } from "./shared";

/** `trigger.message_received` — sem ajustes: toda mensagem de cliente serve. */
export function TriggerMessageReceivedForm() {
  const t = useT();
  return (
    <Aviso
      texto={t(
        "Este fluxo começa sozinho toda vez que um cliente manda mensagem. Para reagir só a certas palavras, use o bloco de palavra-chave.",
      )}
    />
  );
}
