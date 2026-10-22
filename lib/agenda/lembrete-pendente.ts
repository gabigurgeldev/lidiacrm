/**
 * O LEMBRETE QUE FICOU PARA TRÁS quando o agendamento mudou (migration 0245).
 *
 * O lembrete à cliente entra pela fila `conversation_scheduled_messages`, e o
 * agendamento guarda três marcas dele: `reminder_sent_at` (a reivindicação do
 * cron), `reminder_scheduled_message_id` (a linha da fila) e
 * `reminder_skipped_reason` (por que não foi).
 *
 * Remarcar e cancelar invalidam o lembrete antigo pelos dois lados:
 *
 *   1. a mensagem que AINDA está `scheduled` na fila vai para `cancelled` — senão
 *      a cliente recebe "sua consulta é amanhã às 10h" para um horário que não
 *      existe mais;
 *   2. as três marcas voltam a NULL — senão, numa remarcação, o cron acha que o
 *      lembrete já saiu e a cliente nunca é lembrada do horário NOVO.
 *
 * ⚠️ Só `scheduled` é cancelada. `sending`/`sent` já saíram ou estão saindo, e
 * `queued` tem dono (o motor reagenda) — mexer nelas seria mentir sobre o que
 * aconteceu. O efeito colateral de um lembrete já enviado não se desfaz.
 *
 * ⚠️ NUNCA LANÇA. Quem chama é a mutação principal (remarcar/cancelar), e um
 * lembrete que não deu para cancelar não pode derrubar a remarcação que a
 * cliente pediu. A falha vira log com o id, para alguém poder ir atrás.
 *
 * O `organization_id` vai em toda query: pelo MCP o client é service role.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

export interface DesfechoDoLembretePendente {
  /** A mensagem da fila que foi cancelada, quando havia uma ainda `scheduled`. */
  mensagemCancelada: string | null;
  /** As marcas do agendamento foram zeradas. */
  marcasZeradas: boolean;
}

export async function cancelarLembretePendente(
  supabase: SupabaseClient,
  organizationId: string,
  appointmentId: string,
): Promise<DesfechoDoLembretePendente> {
  const desfecho: DesfechoDoLembretePendente = { mensagemCancelada: null, marcasZeradas: false };
  try {
    const { data: atual, error: erroLeitura } = await supabase
      .from("calendar_appointments")
      .select("reminder_sent_at, reminder_scheduled_message_id, reminder_skipped_reason")
      .eq("organization_id", organizationId)
      .eq("id", appointmentId)
      .maybeSingle();
    if (erroLeitura) throw new Error(erroLeitura.message);
    if (!atual) return desfecho;

    const linha = atual as {
      reminder_sent_at: string | null;
      reminder_scheduled_message_id: string | null;
      reminder_skipped_reason: string | null;
    };

    if (linha.reminder_scheduled_message_id) {
      const { data: cancelada, error: erroFila } = await supabase
        .from("conversation_scheduled_messages")
        .update({ status: "cancelled" })
        .eq("organization_id", organizationId)
        .eq("id", linha.reminder_scheduled_message_id)
        .eq("status", "scheduled")
        .select("id")
        .maybeSingle();
      if (erroFila) throw new Error(erroFila.message);
      desfecho.mensagemCancelada = (cancelada as { id: string } | null)?.id ?? null;
    }

    // Nada a zerar: não toca na linha (um UPDATE vazio ainda dispararia o
    // trigger de `updated_at` e moveria o relógio do agendamento à toa).
    if (!linha.reminder_sent_at && !linha.reminder_scheduled_message_id && !linha.reminder_skipped_reason) {
      return desfecho;
    }

    const { error: erroMarcas } = await supabase
      .from("calendar_appointments")
      .update({
        reminder_sent_at: null,
        reminder_scheduled_message_id: null,
        reminder_skipped_reason: null,
      })
      .eq("organization_id", organizationId)
      .eq("id", appointmentId);
    if (erroMarcas) throw new Error(erroMarcas.message);
    desfecho.marcasZeradas = true;
  } catch (err) {
    logger.error("agenda: não consegui cancelar o lembrete pendente", {
      organization_id: organizationId,
      appointment_id: appointmentId,
      erro: err instanceof Error ? err.message : String(err),
    });
  }
  return desfecho;
}
