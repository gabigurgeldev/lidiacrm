"use client";
import { useCallback } from "react";

import { useActiveOrg, useUserOpcional } from "@/hooks/auth/AuthProvider";
import { getOpenConversationId } from "@/hooks/notifications/OpenConversationContext";
import { contactNotifyBits, rowFromRealtime } from "@/hooks/notifications/useInboundMessageAlerts";
import { useRealtimeChannel } from "@/hooks/realtime/useRealtimeChannel";
import { entregarAviso } from "@/lib/notifications/deliver";
import { deveAvisarLeadNovo } from "@/lib/notifications/policy";
import { createClient } from "@/lib/supabase/browser";

/** A mensagem e a atribuição do mesmo cliente, dentro deste tempo, bipam uma vez só. */
export const JANELA_DO_SOM_DE_LEAD_NOVO_MS = 60_000;

function abaFocada(): boolean {
  if (typeof document === "undefined") return false;
  return document.visibilityState === "visible" && document.hasFocus();
}

/**
 * "CHEGOU CLIENTE NOVO PARA VOCÊ" — avisa quando uma conversa é atribuída à
 * pessoa logada (rodízio, transferência, passagem da IA).
 *
 * Existe porque, nas orgs "só as minhas", a primeira mensagem de um lead chega
 * INVISÍVEL para a atendente: a conversa ainda não tem dono, a RLS esconde o
 * INSERT em `messages`, e `useInboundMessageAlerts` não dispara. O que torna a
 * conversa dela é a atribuição, e é ela que este hook escuta.
 *
 * Escuta o INSERT em `conversation_assignment_events` (publicada pela migration
 * 0256), e não o UPDATE em `conversations`: ver o cabeçalho da 0256.
 */
export function useNovaConversaAlerts(): void {
  const orgId = useActiveOrg()?.orgId ?? null;
  const userId = useUserOpcional()?.id ?? null;

  const onChange = useCallback(
    (payload: unknown) => {
      const row = rowFromRealtime(payload);
      if (!row || !userId) return;
      const conversationId = typeof row.conversation_id === "string" ? row.conversation_id : null;
      if (
        !deveAvisarLeadNovo({
          toUserId: typeof row.to_user_id === "string" ? row.to_user_id : null,
          userId,
          changedBy: typeof row.changed_by === "string" ? row.changed_by : null,
          conversationId,
          openConversationId: getOpenConversationId(),
          tabFocused: abaFocada(),
        })
      ) {
        return;
      }
      void (async () => {
        const { data } = await createClient()
          .from("conversations")
          .select("contact_id")
          .eq("id", conversationId!)
          .maybeSingle();
        const contactId = (data as { contact_id?: string | null } | null)?.contact_id ?? null;
        const bits = contactId ? await contactNotifyBits(contactId) : { title: "Novo cliente", icon: undefined };
        entregarAviso({
          category: "lead_assigned",
          kind: "lead_novo",
          title: bits.title,
          body: "Novo cliente para você",
          tag: conversationId!,
          href: `/app/inbox?id=${conversationId}`,
          icon: bits.icon,
          chaveDoSom: typeof row.id === "string" ? row.id : conversationId!,
          grupoDoSom: contactId ? `contato:${contactId}` : undefined,
          janelaDoSomMs: JANELA_DO_SOM_DE_LEAD_NOVO_MS,
        });
      })();
    },
    [userId],
  );

  useRealtimeChannel({
    name: orgId && userId ? `alerts-atribuicao-${orgId}-${userId}` : "alerts-atribuicao-disabled",
    postgresChanges:
      orgId && userId
        ? {
            event: "INSERT",
            schema: "public",
            table: "conversation_assignment_events",
            filter: `to_user_id=eq.${userId}`,
          }
        : undefined,
    onChange,
    enabled: !!orgId && !!userId,
  });
}
