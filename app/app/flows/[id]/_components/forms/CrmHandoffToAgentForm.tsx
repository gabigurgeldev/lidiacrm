"use client";

import { useT } from "@/hooks/i18n/useT";

import { Aviso } from "./shared";

/**
 * `crm.handoff_to_agent` — sem campos, e com um aviso que precisa estar aqui.
 *
 * Este bloco desfaz a passagem para humano, inclusive a trava que o próprio
 * agente de IA não pode soltar sozinho (`contacts.force_human`, ver
 * `lib/escalacao/retomada.ts`). Quem monta o fluxo precisa saber disso ANTES de
 * publicar, e não depois de descobrir que uma conversa escalada voltou para a
 * IA sem ninguém pedir.
 */
export function CrmHandoffToAgentForm() {
  const t = useT();
  return (
    <Aviso
      texto={t(
        "A conversa volta para o agente de IA atender. Se ela tinha sido passada para uma pessoa, esta passagem é DESFEITA — inclusive quando foi um atendente que assumiu. Use depois de ter certeza de que o humano terminou.",
      )}
    />
  );
}
