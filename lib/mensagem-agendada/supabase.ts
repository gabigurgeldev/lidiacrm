/**
 * As portas reais do motor da mensagem agendada (`./motor.ts`).
 *
 * Service role: o cron não tem sessão. Toda escrita filtra `organization_id`
 * da PRÓPRIA linha reivindicada (fonte confiável: o banco), e toda leitura de
 * contato/conexão também — anti-pattern nº 10 do CLAUDE.md.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { acharOuCriarContato } from "@/lib/automation/contato-do-aviso";
import { desfechoDoEnvio, type MensagemEnviada } from "@/lib/automation/desfecho-do-envio";
import type { ContatoDoContexto } from "@/lib/automation/guarda-do-contato";
import { adiarAteAJanelaAbrir } from "@/lib/automation/janela-do-canal";
import { ensureConversation } from "@/lib/automation/start-conversation";
import { organizacaoPodeOperar } from "@/lib/billing/servico";
import { espacarEnvio } from "@/lib/automation/throttle";
import type { Actor } from "@/lib/api/handlers/types";
import { logger } from "@/lib/logger";

import type { Agendamento, DesfechoDoEnvio, PortasDoMotor } from "./motor";

const TABELA = "conversation_scheduled_messages";
const COLUNAS =
  "id, organization_id, conversation_id, contact_id, channel_session_id, body, scheduled_for, notify_phone, notify_body, created_by_user_id";

/** Tempo que uma linha fica travada em `sending`. Envio + aviso cabem folgado. */
const TRAVA_MS = 5 * 60_000;

async function enviarTexto(
  admin: SupabaseClient,
  a: Agendamento,
  conversationId: string,
  texto: string,
  actor: Actor,
): Promise<DesfechoDoEnvio> {
  try {
    const mensagem = (await sendMessageHandler(
      admin,
      { organization_id: a.organization_id, actor, requestId: `scheduled:${a.id}` },
      { conversation_id: conversationId, type: "text", body: texto } as Parameters<
        typeof sendMessageHandler
      >[2],
    )) as unknown as MensagemEnviada;
    const traduzido = desfechoDoEnvio("scheduled_message", mensagem);
    if (traduzido.status === "success") return { kind: "enviado", messageId: mensagem.id };
    if (traduzido.status === "postponed") {
      const motivo =
        typeof mensagem.metadata?.queued_reason === "string"
          ? mensagem.metadata.queued_reason
          : "aguardando_o_canal";
      return { kind: "na_fila", messageId: mensagem.id, motivo };
    }
    return {
      kind: "recusado",
      messageId: mensagem.id,
      motivo: mensagem.error_message ?? mensagem.error_code ?? "envio_recusado",
    };
  } catch (err) {
    return { kind: "recusado", motivo: err instanceof Error ? err.message : "erro_no_envio" };
  }
}

export function portasDoSupabase(admin: SupabaseClient): PortasDoMotor {
  return {
    async resgatarPresas(agora) {
      const { data, error } = await admin
        .from(TABELA)
        .update({ status: "failed", failure_reason: "envio_interrompido", claimed_until: null })
        .eq("status", "sending")
        .lt("claimed_until", agora.toISOString())
        .select(COLUNAS);
      if (error) {
        logger.warn("mensagem-agendada: não consegui resgatar presas", { erro: error.message });
        return [];
      }
      return (data ?? []) as Agendamento[];
    },

    async reivindicarVencidas(agora, limite) {
      const { data: vencidas, error } = await admin
        .from(TABELA)
        .select("id")
        .eq("status", "scheduled")
        .lte("scheduled_for", agora.toISOString())
        .order("scheduled_for", { ascending: true })
        .limit(limite);
      if (error || !vencidas?.length) return [];
      // O UPDATE condicionado a `status='scheduled'` É o claim: dois ticks
      // concorrentes leem as mesmas ids, só o primeiro as muda.
      const { data } = await admin
        .from(TABELA)
        .update({
          status: "sending",
          claimed_until: new Date(agora.getTime() + TRAVA_MS).toISOString(),
        })
        .in(
          "id",
          vencidas.map((v) => (v as { id: string }).id),
        )
        .eq("status", "scheduled")
        .select(COLUNAS);
      return (data ?? []) as Agendamento[];
    },

    podeOperar: organizacaoPodeOperar,

    janelaAbreEm(a, agora) {
      return adiarAteAJanelaAbrir(admin, a.organization_id, a.channel_session_id, agora);
    },

    async contato(a) {
      const { data } = await admin
        .from("contacts")
        .select("id, is_blocked, phone_number, is_anonymized, is_merged_into")
        .eq("id", a.contact_id)
        .eq("organization_id", a.organization_id)
        .maybeSingle();
      return (data as ContatoDoContexto | null) ?? null;
    },

    async enviarAoCliente(a) {
      await espacarEnvio(a.channel_session_id);
      let conversationId: string;
      try {
        conversationId = await ensureConversation(
          admin,
          a.organization_id,
          a.contact_id,
          a.channel_session_id,
        );
      } catch (err) {
        return { kind: "recusado", motivo: err instanceof Error ? err.message : "sem_conversa" };
      }
      // Em nome de quem marcou: a mensagem aparece na conversa como dele, e
      // silencia o robô como a mensagem digitada silencia.
      const actor: Actor = a.created_by_user_id
        ? { type: "user", id: a.created_by_user_id }
        : { type: "webhook_source", id: `scheduled:${a.id}` };
      return enviarTexto(admin, a, conversationId, a.body, actor);
    },

    async enviarAviso(a) {
      if (!a.notify_phone || !a.notify_body) return { kind: "recusado", motivo: "sem_aviso" };
      await espacarEnvio(a.channel_session_id);
      try {
        const contactId = await acharOuCriarContato(admin, a.organization_id, a.notify_phone, true);
        const conversationId = await ensureConversation(
          admin,
          a.organization_id,
          contactId,
          a.channel_session_id,
        );
        return enviarTexto(admin, a, conversationId, a.notify_body, {
          type: "webhook_source",
          id: `scheduled:${a.id}`,
        });
      } catch (err) {
        return { kind: "recusado", motivo: err instanceof Error ? err.message : "erro_no_aviso" };
      }
    },

    async remarcar(a, paraIso) {
      await admin
        .from(TABELA)
        .update({ status: "scheduled", scheduled_for: paraIso, claimed_until: null })
        .eq("id", a.id)
        .eq("organization_id", a.organization_id);
    },

    async concluir(a, c) {
      const { error } = await admin
        .from(TABELA)
        .update({
          status: c.status,
          message_id: c.message_id,
          notify_message_id: c.notify_message_id,
          failure_reason: c.failure_reason,
          claimed_until: null,
          sent_at: c.status === "sent" ? new Date().toISOString() : null,
        })
        .eq("id", a.id)
        .eq("organization_id", a.organization_id);
      if (error) {
        logger.error("mensagem-agendada: não consegui gravar o desfecho", {
          erro: error.message,
          id: a.id,
        });
      }
    },

    async abrirAviso(a, titulo, corpo) {
      // `kind: 'other'` + `ref_kind`, como o motor de fluxos: o CHECK de `kind`
      // é fechado, e a identidade real vai no ponteiro.
      const { error } = await admin.from("agent_inbox_items").insert({
        organization_id: a.organization_id,
        kind: "other",
        severity: "warn",
        title: titulo,
        body: corpo,
        ref_kind: "conversation",
        ref_id: a.conversation_id,
        status: "open",
      });
      if (error) {
        logger.warn("mensagem-agendada: não consegui abrir o aviso na Central", {
          erro: error.message,
          id: a.id,
        });
      }
    },
  };
}
