import { organizacaoPodeOperar } from "@/lib/billing/servico";
import { createAdminClient } from "@/lib/supabase/admin";
import type { EventHandler } from "@/lib/event-log/dispatcher";
import { AUTOMATION_CONSUMER_KEY, runAutomationForEvent } from "@/lib/automation/engine";
// Importa os executores para que se registrem (side-effect imports — Tasks 9-11):
import "@/lib/automation/actions/register-all";

export const automationRulesHandler: EventHandler = {
  key: AUTOMATION_CONSUMER_KEY,
  events: ["lead.created", "lead.stage_changed", "message.received", "lead.tag_added", "contact.tag_added"],
  async handle(row) {
    // Assinatura vencida: regra automática não dispara (nada de WhatsApp, webhook
    // ou mudança de etapa em nome de quem não pagou). O evento fica registrado
    // como pulado, com o motivo.
    if (!(await organizacaoPodeOperar(row.organization_id))) {
      return { consumer_key: AUTOMATION_CONSUMER_KEY, status: "skipped", detail: "assinatura_bloqueada" };
    }
    return runAutomationForEvent(createAdminClient(), row);
  },
};
