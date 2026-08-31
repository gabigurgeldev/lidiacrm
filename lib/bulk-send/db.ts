/**
 * O SEAM: `DisparoDb` implementado sobre Supabase.
 *
 * Molde de `createSupabaseAdminClient` do follow-up. Tudo o que este arquivo faz
 * é traduzir consulta — a regra inteira está em `motor.ts`, que não conhece
 * PostgREST e por isso é testável com dublês.
 *
 * ⚠️ O worker roda com SERVICE ROLE, que BYPASSA RLS. Então toda consulta aqui
 * leva `organization_id` explícito, inclusive as que já filtram por
 * `bulk_send_id` — cinto e suspensório. A `organization_id` NUNCA vem de
 * payload: vem da linha do próprio disparo, que o claim devolveu.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { MensagemEnviada } from "@/lib/automation/desfecho-do-envio";
import { configDePacingDoCanal } from "@/lib/automation/janela-do-canal";
import { estadoDePacing, registrarEnvioNoLedger } from "@/lib/bulk-send/pacing-supabase";
import type {
  DestinatarioPendente,
  DisparoDb,
  DisparoEmVoo,
  EmVooOrfao,
  SessaoDoCanal,
} from "@/lib/bulk-send/motor";
import { ARCHIVED_AT, queryTolerantToMissingArchived } from "@/lib/channels/archived";
import { logger } from "@/lib/logger";

/** As colunas do contato que as guardas leem. Nem uma a mais — é PII. */
const COLUNAS_DO_CONTATO = "id, phone_number, is_blocked, is_anonymized, is_merged_into, consent";

export function criarDisparoDb(admin: SupabaseClient): DisparoDb {
  return {
    async promoverAgendados(agora) {
      const { data, error } = await admin
        .from("bulk_sends")
        .update({
          status: "running",
          next_send_at: agora.toISOString(),
          pause_reason: null,
          pause_detail: null,
          updated_at: agora.toISOString(),
        })
        .eq("status", "scheduled")
        .lte("scheduled_for", agora.toISOString())
        .select("id");
      if (error) {
        logger.error("[bulk-send.db] promoção de agendados falhou", { causa: error.message });
        return 0;
      }
      return (data ?? []).length;
    },

    async reclamarDisparos(limite, leaseSegundos) {
      const { data, error } = await admin.rpc("fn_claim_due_bulk_sends", {
        p_limit: limite,
        p_lease_seconds: leaseSegundos,
      });
      // Lança de propósito: o motor traduz em `claim_falhou`, que é o que
      // distingue "o banco não respondeu" de "não havia nada a fazer".
      if (error) throw new Error(error.message);
      return (data ?? []) as DisparoEmVoo[];
    },

    async sessaoDoCanal(organizationId, channelSessionId) {
      // `archived_at` pelo helper tolerante: num clone que subiu o código sem a
      // migration 0106, pedir a coluna direto derruba a consulta com 42703 — e
      // sem a coluna, nada está arquivado.
      const select = (comArchived: boolean) =>
        `id, provider, status, daily_message_limit${comArchived ? `, ${ARCHIVED_AT}` : ""}`;
      const { data, error } = await queryTolerantToMissingArchived(
        () =>
          admin
            .from("channel_sessions")
            .select(select(true))
            .eq("id", channelSessionId)
            .eq("organization_id", organizationId)
            .maybeSingle(),
        () =>
          admin
            .from("channel_sessions")
            .select(select(false))
            .eq("id", channelSessionId)
            .eq("organization_id", organizationId)
            .maybeSingle(),
      );
      if (error || !data) return null;
      const linha = data as unknown as Omit<SessaoDoCanal, "archived_at"> & {
        archived_at?: string | null;
      };
      return { ...linha, archived_at: linha.archived_at ?? null };
    },

    configDePacing: (organizationId, channelSessionId) =>
      configDePacingDoCanal(admin, organizationId, channelSessionId),

    estadoDePacing: (organizationId, channelSessionId, entrada) =>
      estadoDePacing(admin, organizationId, channelSessionId, entrada),

    async emVooOrfaos(bulkSendId, organizationId) {
      const { data, error } = await admin
        .from("bulk_send_recipients")
        .select("id, message_id, attempts")
        .eq("bulk_send_id", bulkSendId)
        .eq("organization_id", organizationId)
        .eq("status", "sending");
      if (error) {
        logger.error("[bulk-send.db] varredura de em-voo falhou", { causa: error.message });
        return [];
      }
      return (data ?? []) as EmVooOrfao[];
    },

    async lerMensagem(organizationId, messageId) {
      const { data, error } = await admin
        .from("messages")
        .select("id, status, error_code, error_message, metadata")
        .eq("id", messageId)
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (error || !data) return null;
      return data as unknown as MensagemEnviada;
    },

    async proximoPendente(bulkSendId, organizationId) {
      const { data, error } = await admin
        .from("bulk_send_recipients")
        .select(`id, contact_id, contacts:contact_id(${COLUNAS_DO_CONTATO})`)
        .eq("bulk_send_id", bulkSendId)
        .eq("organization_id", organizationId)
        .eq("status", "pending")
        // Ordem estável: a mesma fila em todo tique, e retomada previsível.
        .order("id", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error || !data) return null;
      const linha = data as unknown as {
        id: string;
        contact_id: string;
        contacts: DestinatarioPendente["contato"];
      };
      return { id: linha.id, contact_id: linha.contact_id, contato: linha.contacts ?? null };
    },

    async marcarDestinatario(id, organizationId, patch) {
      const update: Record<string, unknown> = { status: patch.status };
      if (patch.skip_reason !== undefined) update.skip_reason = patch.skip_reason;
      if (patch.error !== undefined) update.error = patch.error;
      if (patch.message_id !== undefined) update.message_id = patch.message_id;
      if (patch.sent_at !== undefined) update.sent_at = patch.sent_at;

      // `pending` limpa o motivo de pulo: o CHECK
      // `bulk_send_recipients_skip_tem_motivo` cobra a equivalência nos dois
      // sentidos, e uma linha que volta para a fila com motivo antigo o viola.
      if (patch.status !== "skipped") update.skip_reason = null;

      const { error } = await admin
        .from("bulk_send_recipients")
        .update(update)
        .eq("id", id)
        .eq("organization_id", organizationId);
      if (error) throw new Error(error.message);

      if (patch.incrementarTentativa) {
        // Contador informativo: uma corrida que o perca não muda desfecho
        // nenhum, então não vale uma RPC dedicada.
        const { data } = await admin
          .from("bulk_send_recipients")
          .select("attempts")
          .eq("id", id)
          .eq("organization_id", organizationId)
          .maybeSingle();
        const atual = (data as { attempts: number } | null)?.attempts ?? 0;
        await admin
          .from("bulk_send_recipients")
          .update({ attempts: atual + 1 })
          .eq("id", id)
          .eq("organization_id", organizationId);
      }
    },

    async atualizarDisparo(id, organizationId, patch) {
      const { error } = await admin
        .from("bulk_sends")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("organization_id", organizationId);
      if (error) throw new Error(error.message);
    },

    registrarEnvioNoLedger: (organizationId, channelSessionId, sentAt) =>
      registrarEnvioNoLedger(admin, organizationId, channelSessionId, sentAt),

    async avisarNaCentral(entrada) {
      // Um aviso ABERTO por disparo, nunca um por tique: uma campanha que passa
      // a noite fora da janela abriria uma linha por minuto, e a Central que
      // enche é a Central que ninguém lê.
      const { data: jaTem } = await admin
        .from("agent_inbox_items")
        .select("id")
        .eq("organization_id", entrada.organizationId)
        .eq("kind", "disparo_travado")
        .eq("ref_kind", "bulk_send")
        .eq("ref_id", entrada.bulkSendId)
        // `status='open'` é o que "ainda não tratado" significa nesta tabela —
        // não há `resolved_at`. O índice parcial `idx_agent_inbox_items_ref_aberto`
        // (ref_kind, ref_id) where status='open' serve exatamente esta consulta.
        .eq("status", "open")
        .limit(1)
        .maybeSingle();
      if (jaTem) return;

      const { error } = await admin.from("agent_inbox_items").insert({
        organization_id: entrada.organizationId,
        kind: "disparo_travado",
        severity: entrada.severidade,
        title: entrada.titulo,
        body: entrada.corpo,
        ref_kind: "bulk_send",
        ref_id: entrada.bulkSendId,
      });
      // Fire-and-forget: um aviso que não pôde ser aberto não pode derrubar o
      // disparo — mas também não pode sumir sem log.
      if (error) {
        logger.error("[bulk-send.db] aviso da Central não foi aberto", {
          causa: error.message,
          bulkSendId: entrada.bulkSendId,
        });
      }
    },
  };
}
