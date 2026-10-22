/**
 * As portas reais do motor do lembrete (`./motor.ts`).
 *
 * Service role: o cron não tem sessão. A varredura é de TODAS as organizações
 * (é um cron), e daí em diante toda leitura e escrita filtra o
 * `organization_id` da PRÓPRIA linha do agendamento — fonte confiável: o banco
 * (anti-pattern nº 10 do CLAUDE.md).
 *
 * ⚠️ Nenhum provedor de canal é nomeado aqui. A regra "este número aceita
 * texto livre agora?" é de `estadoDaJanela` (`lib/channels/janela.ts`), que lê
 * as capacidades da sessão — o lembrete só pergunta.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { REF_KIND_DO_AGENDAMENTO, type MotivoDeLembretePulado } from "@/lib/agenda/tipos";
import { ARCHIVED_AT, queryTolerantToMissingArchived } from "@/lib/channels/archived";
import { estadoDaJanela } from "@/lib/channels/janela";
import { logger } from "@/lib/logger";

import type { AgendamentoParaLembrete, PortasDoLembrete, ResolucaoDoCanal } from "./motor";

/** O maior `reminder_minutes_before` que o CHECK do tipo aceita (30 dias). */
const HORIZONTE_MAXIMO_MS = 43_200 * 60_000;

/**
 * Folga mínima da janela de 24h para o lembrete sair por um número que exige
 * modelo fora dela. A fila ainda pode segurar a mensagem até o horário de envio
 * do número abrir; com menos de uma hora, ela chegaria lá com a janela fechada.
 */
const FOLGA_DA_JANELA_MS = 60 * 60_000;

const TABELA = "calendar_appointments";

interface LinhaDoCandidato {
  id: string;
  organization_id: string;
  starts_at: string;
  created_at: string;
  status: string;
  time_zone: string;
  contact_id: string | null;
  conversation_id: string | null;
  reminder_sent_at: string | null;
  reminder_skipped_reason: string | null;
  tipo:
    | { name: string; reminder_enabled: boolean; reminder_minutes_before: number }
    | { name: string; reminder_enabled: boolean; reminder_minutes_before: number }[]
    | null;
}

interface Conversa {
  id: string;
  contact_id: string;
  channel_session_id: string | null;
  is_group: boolean;
  last_inbound_at: string | null;
}

export function portasDoLembrete(admin: SupabaseClient): PortasDoLembrete {
  return {
    async candidatos(agora, limite) {
      const { data, error } = await admin
        .from(TABELA)
        .select(
          "id, organization_id, starts_at, created_at, status, time_zone, contact_id, conversation_id, " +
            "reminder_sent_at, reminder_skipped_reason, " +
            "tipo:calendar_event_types!calendar_appointments_event_type_id_fkey!inner(name, reminder_enabled, reminder_minutes_before)",
        )
        .is("reminder_sent_at", null)
        .is("reminder_skipped_reason", null)
        .eq("status", "confirmed")
        .not("contact_id", "is", null)
        .gt("starts_at", agora.toISOString())
        .lte("starts_at", new Date(agora.getTime() + HORIZONTE_MAXIMO_MS).toISOString())
        .eq("tipo.reminder_enabled", true)
        .order("starts_at", { ascending: true })
        .limit(limite);
      // Falha de varredura SOBE: engolir viraria "rodada sem nada a fazer", e o
      // lembrete pararia de sair com o cron verde.
      if (error) throw new Error(`agenda-lembretes: varredura falhou — ${error.message}`);
      return ((data ?? []) as unknown as LinhaDoCandidato[]).map((l): AgendamentoParaLembrete => {
        const tipo = Array.isArray(l.tipo) ? l.tipo[0] : l.tipo;
        return {
          id: l.id,
          organization_id: l.organization_id,
          starts_at: l.starts_at,
          created_at: l.created_at,
          status: l.status,
          time_zone: l.time_zone,
          contact_id: l.contact_id,
          conversation_id: l.conversation_id,
          reminder_sent_at: l.reminder_sent_at,
          reminder_skipped_reason: l.reminder_skipped_reason,
          tipo: tipo
            ? {
                nome: tipo.name,
                reminder_enabled: tipo.reminder_enabled,
                reminder_minutes_before: tipo.reminder_minutes_before,
              }
            : null,
        };
      });
    },

    async marcarPulado(ag, motivo) {
      const { data, error } = await admin
        .from(TABELA)
        .update({ reminder_skipped_reason: motivo })
        .eq("id", ag.id)
        .eq("organization_id", ag.organization_id)
        .is("reminder_sent_at", null)
        .is("reminder_skipped_reason", null)
        .select("id");
      if (error) {
        logger.warn("agenda-lembretes: não consegui gravar o pulo", { erro: error.message, id: ag.id });
        return false;
      }
      return (data ?? []).length > 0;
    },

    async reivindicar(ag, agora) {
      // O UPDATE condicionado É o claim: dois ticks leem a mesma linha, só o
      // primeiro a muda — o segundo recebe zero linhas e segue.
      const { data, error } = await admin
        .from(TABELA)
        .update({ reminder_sent_at: agora.toISOString() })
        .eq("id", ag.id)
        .eq("organization_id", ag.organization_id)
        .eq("status", "confirmed")
        .is("reminder_sent_at", null)
        .is("reminder_skipped_reason", null)
        .select("id");
      if (error) {
        logger.warn("agenda-lembretes: não consegui reivindicar", { erro: error.message, id: ag.id });
        return false;
      }
      return (data ?? []).length > 0;
    },

    async canal(ag, agora): Promise<ResolucaoDoCanal> {
      if (!ag.contact_id) return { tipo: "pular", motivo: "sem_conversa" };

      const { data: contato } = await admin
        .from("contacts")
        .select("id, name, display_name, is_blocked, is_anonymized, is_merged_into")
        .eq("id", ag.contact_id)
        .eq("organization_id", ag.organization_id)
        .maybeSingle();
      const c = contato as {
        name: string | null;
        display_name: string | null;
        is_blocked: boolean | null;
        is_anonymized: boolean | null;
        is_merged_into: string | null;
      } | null;
      if (!c) return { tipo: "pular", motivo: "sem_conversa" };
      // Bloqueado, anonimizado (LGPD) ou mesclado: esta pessoa não recebe mais
      // mensagem por aqui. A fila também barraria; pular AGORA deixa o motivo
      // escrito no agendamento, onde a equipe olha.
      if (c.is_blocked || c.is_anonymized || c.is_merged_into) {
        return { tipo: "pular", motivo: "contato_bloqueado" };
      }

      const colunas = "id, contact_id, channel_session_id, is_group, last_inbound_at";
      let conversa: Conversa | null = null;
      if (ag.conversation_id) {
        const { data } = await admin
          .from("conversations")
          .select(colunas)
          .eq("id", ag.conversation_id)
          .eq("organization_id", ag.organization_id)
          .maybeSingle();
        const lida = data as Conversa | null;
        if (lida && !lida.is_group && lida.contact_id === ag.contact_id && lida.channel_session_id) {
          conversa = lida;
        }
      }
      if (!conversa) {
        // Sem a conversa em que foi marcado (a tela marca sem conversa): a mais
        // recente 1:1 do contato — é o número com que ele fala.
        const { data } = await admin
          .from("conversations")
          .select(colunas)
          .eq("organization_id", ag.organization_id)
          .eq("contact_id", ag.contact_id)
          .eq("is_group", false)
          .not("channel_session_id", "is", null)
          .order("last_message_at", { ascending: false, nullsFirst: false })
          .limit(1);
        conversa = ((data ?? []) as Conversa[])[0] ?? null;
      }
      if (!conversa?.channel_session_id) return { tipo: "pular", motivo: "sem_conversa" };

      const sessaoId = conversa.channel_session_id;
      const { data: sessao } = await queryTolerantToMissingArchived(
        () =>
          admin
            .from("channel_sessions")
            .select(`id, provider, provider_mode, ${ARCHIVED_AT}`)
            .eq("id", sessaoId)
            .eq("organization_id", ag.organization_id)
            .maybeSingle(),
        () =>
          admin
            .from("channel_sessions")
            .select("id, provider, provider_mode")
            .eq("id", sessaoId)
            .eq("organization_id", ag.organization_id)
            .maybeSingle(),
      );
      const s = sessao as { provider: string; provider_mode: string | null; archived_at?: string | null } | null;
      // Número excluído: a fila recusaria a linha. Sem número, não há conversa.
      if (!s || s.archived_at) return { tipo: "pular", motivo: "sem_conversa" };

      const janela = estadoDaJanela(s.provider, conversa.last_inbound_at, agora, s.provider_mode);
      const livre =
        janela.tipo === "sem_restricao" || (janela.tipo === "aberta" && janela.restanteMs >= FOLGA_DA_JANELA_MS);
      if (!livre) return { tipo: "pular", motivo: "canal_exige_template" };

      return {
        tipo: "ok",
        canal: {
          conversationId: conversa.id,
          channelSessionId: sessaoId,
          contactId: ag.contact_id,
          nomeDoCliente: c.name ?? c.display_name ?? null,
        },
      };
    },

    async profissionais(ag) {
      const { data: participantes } = await admin
        .from("calendar_appointment_professionals")
        .select("professional_id, role")
        .eq("organization_id", ag.organization_id)
        .eq("appointment_id", ag.id);
      const linhas = (participantes ?? []) as { professional_id: string; role: string }[];
      if (linhas.length === 0) return [];
      const { data: pessoas } = await admin
        .from("calendar_professionals")
        .select("id, name")
        .eq("organization_id", ag.organization_id)
        .in(
          "id",
          linhas.map((l) => l.professional_id),
        );
      const nomePorId = new Map(((pessoas ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
      return [...linhas]
        .sort((a, b) => (a.role === "principal" ? -1 : b.role === "principal" ? 1 : 0))
        .map((l) => nomePorId.get(l.professional_id))
        .filter((n): n is string => Boolean(n));
    },

    async enfileirar(ag, canal, texto, agora) {
      const { data, error } = await admin
        .from("conversation_scheduled_messages")
        .insert({
          organization_id: ag.organization_id,
          conversation_id: canal.conversationId,
          contact_id: canal.contactId,
          channel_session_id: canal.channelSessionId,
          body: texto,
          scheduled_for: agora.toISOString(),
          // Ninguém marcou à mão: a mensagem sai em nome do sistema, como o
          // aviso da mensagem agendada (`lib/mensagem-agendada/supabase.ts`).
          created_by_user_id: null,
        })
        .select("id")
        .single();
      if (error || !data) {
        logger.warn("agenda-lembretes: a fila recusou o lembrete", { erro: error?.message, id: ag.id });
        return null;
      }
      return String((data as { id: string }).id);
    },

    async confirmar(ag, mensagemAgendadaId) {
      const { error } = await admin
        .from(TABELA)
        .update({ reminder_scheduled_message_id: mensagemAgendadaId })
        .eq("id", ag.id)
        .eq("organization_id", ag.organization_id);
      if (error) {
        // A mensagem JÁ está na fila: o lembrete sai. O que se perde é só o
        // ponteiro que deixa remarcar/cancelar retirá-la.
        logger.error("agenda-lembretes: lembrete enfileirado sem ponteiro no agendamento", {
          erro: error.message,
          id: ag.id,
          mensagem_agendada_id: mensagemAgendadaId,
        });
      }
    },

    async devolver(ag, motivo: MotivoDeLembretePulado | null) {
      const { error } = await admin
        .from(TABELA)
        .update({ reminder_sent_at: null, reminder_skipped_reason: motivo })
        .eq("id", ag.id)
        .eq("organization_id", ag.organization_id)
        .is("reminder_scheduled_message_id", null);
      if (error) {
        logger.warn("agenda-lembretes: não consegui devolver a reivindicação", { erro: error.message, id: ag.id });
      }
    },

    async avisar(ag, titulo, corpo) {
      // `kind: 'other'` + `ref_kind`: o CHECK de `kind` é fechado, e a
      // identidade real vai no ponteiro — o clique abre o agendamento.
      const { error } = await admin.from("agent_inbox_items").insert({
        organization_id: ag.organization_id,
        kind: "other",
        severity: "warn",
        title: titulo,
        body: corpo,
        ref_kind: REF_KIND_DO_AGENDAMENTO,
        ref_id: ag.id,
        status: "open",
      });
      if (error) {
        logger.warn("agenda-lembretes: não consegui abrir o aviso na Central", { erro: error.message, id: ag.id });
      }
    },
  };
}
