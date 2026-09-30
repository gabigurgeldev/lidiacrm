/**
 * O CONTATO PARA ONDE VAI UM AVISO À EQUIPE.
 *
 * Mandar WhatsApp para o atendente exige uma conversa, e conversa exige um
 * contato. Nasceu no motor de fluxos (`whatsapp.notify_user`) e saiu de lá
 * quando a mensagem agendada pela conversa passou a avisar o atendente também:
 * duas cópias seriam duas réguas de `force_human` — e é esse campo que impede o
 * agente de IA de tratar o vendedor como cliente quando ele responde ao aviso.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Marca do contato criado só para avisar alguém da equipe. */
export const ORIGEM_DO_CONTATO_INTERNO = "flow_engine:aviso_interno";

/**
 * Contato para o telefone do aviso. Se for interno, nasce com `force_human`.
 *
 * ⚠️ `force_human = true` NÃO impede o envio — `sendMessageHandler` só barra em
 * `is_blocked`. O que ele faz é armar o `stopGate`, o primeiro gate da cadeia
 * `before_send`, de modo que o AGENTE DE IA não puxa conversa com o vendedor
 * quando ele responder ao aviso. Sem isto, avisar a equipe criaria um contato
 * que o agente trataria como cliente.
 *
 * `origemExterna` é o `source` quando o telefone NÃO é da equipe (o fluxo pode
 * mandar para um número qualquer); o interno usa sempre a mesma marca.
 */
export async function acharOuCriarContato(
  admin: SupabaseClient,
  orgId: string,
  telefone: string,
  interno: boolean,
  origemExterna = "flow_engine",
): Promise<string> {
  const { data: existente } = await admin
    .from("contacts")
    .select("id")
    .eq("organization_id", orgId)
    .eq("phone_number", telefone)
    .maybeSingle();
  if (existente !== null) return (existente as { id: string }).id;

  const { data: criado, error } = await admin
    .from("contacts")
    .insert({
      organization_id: orgId,
      phone_number: telefone,
      name: interno ? "Equipe (avisos)" : null,
      source: interno ? ORIGEM_DO_CONTATO_INTERNO : origemExterna,
      force_human: interno,
    })
    .select("id")
    .single();

  if (error !== null) {
    // Corrida com outro envio avisando o mesmo vendedor no mesmo instante.
    if ((error as { code?: string }).code === "23505") {
      const { data: vencedor } = await admin
        .from("contacts")
        .select("id")
        .eq("organization_id", orgId)
        .eq("phone_number", telefone)
        .maybeSingle();
      if (vencedor !== null) return (vencedor as { id: string }).id;
    }
    throw new Error(error.message);
  }
  return (criado as { id: string }).id;
}
