"use client";

import { useT } from "@/hooks/i18n/useT";

import { Aviso } from "./shared";

/** `trigger.lead_created` — sem ajustes: quem dispara é o funil, não o bloco. */
export function TriggerLeadCreatedForm() {
  const t = useT();
  return <Aviso texto={t("Este fluxo começa sozinho toda vez que um lead novo entra no funil.")} />;
}
