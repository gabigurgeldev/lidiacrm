/**
 * O DETALHE DE UM AGENDAMENTO — tudo o que a gaveta da tela mostra, numa leitura.
 *
 * A listagem (`listaAgendamentos`) carrega o mínimo para desenhar a grade; quem
 * clica num bloco precisa de mais: o serviço pelo nome, o telefone do cliente,
 * quem atende (com nome e cor), o lead e a conversa para os atalhos, e o estado
 * do lembrete. Montar isso na rota faria a segunda leitura (amanhã, a do agente)
 * divergir da primeira — a mesma razão de `./consulta` existir.
 *
 * ⚠️ O client pode ser o ADMIN (service role): TODA query aqui filtra
 * `organization_id` explicitamente, inclusive as de apoio (tipo, contato, lead,
 * profissionais). Um agendamento desta organização com um `contact_id` de outra
 * não existe pelo schema, mas a leitura não confia nisso — anti-pattern nº 10.
 *
 * Leituras SEQUENCIAIS onde dependem do agendamento, e em paralelo depois: o
 * agendamento decide se há o que buscar (sem contato, sem tipo).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { autorDe, origemDe, papelDe } from "./consulta";
import type { DetalheDoAgendamento, ProfissionalResumo } from "./contrato";
import {
  ALVO_DE_VINCULO_DO_AGENDAMENTO,
  PAPEIS_DO_PROFISSIONAL,
  TRILHAS_DA_AGENDA,
  type PapelDoProfissional,
  type TrilhaDaAgenda,
} from "./tipos";

export type ResultadoDoDetalhe =
  | { ok: true; detalhe: DetalheDoAgendamento }
  | { ok: false; codigo: "nao_encontrado" | "erro_interno"; motivoParaOperador: string };

function trilhaDe(valor: unknown): TrilhaDaAgenda | null {
  const n = Number(valor);
  return (TRILHAS_DA_AGENDA as readonly number[]).includes(n) ? (n as TrilhaDaAgenda) : null;
}

/** O nome de exibição do contato — `name` antes de `display_name`, como a listagem. */
function nomeDoContato(c: { name: string | null; display_name: string | null }): string | null {
  return c.name ?? c.display_name ?? null;
}

export async function detalheDoAgendamento(
  supabase: SupabaseClient,
  organizationId: string,
  appointmentId: string,
): Promise<ResultadoDoDetalhe> {
  const { data: ag, error } = await supabase
    .from("calendar_appointments")
    .select(
      "id, title, starts_at, ends_at, time_zone, status, source, created_by_kind, notes, cancellation_reason, event_type_id, contact_id, conversation_id, reminder_sent_at, reminder_skipped_reason, reminder_scheduled_message_id",
    )
    .eq("organization_id", organizationId)
    .eq("id", appointmentId)
    .maybeSingle();
  if (error) return { ok: false, codigo: "erro_interno", motivoParaOperador: error.message };
  if (!ag) {
    // Inexistente e de OUTRA organização são a mesma resposta — dizer "existe,
    // mas não é seu" confirmaria a existência de um id alheio.
    return {
      ok: false,
      codigo: "nao_encontrado",
      motivoParaOperador: "Agendamento não encontrado.",
    };
  }

  const vazio = Promise.resolve({ data: null, error: null });
  const [tipo, contato, lead, parts] = await Promise.all([
    ag.event_type_id
      ? supabase
          .from("calendar_event_types")
          .select("id, name")
          .eq("organization_id", organizationId)
          .eq("id", ag.event_type_id)
          .maybeSingle()
      : vazio,
    ag.contact_id
      ? supabase
          .from("contacts")
          .select("id, name, display_name, phone_number")
          .eq("organization_id", organizationId)
          .eq("id", ag.contact_id)
          .maybeSingle()
      : vazio,
    // DECISÃO 6: o lead é polimórfico (`crm_lead_links`), não coluna. Um
    // agendamento pertence a no máximo um negócio no fluxo do produto; se houver
    // mais de um vínculo, o mais antigo é o que o marcou.
    supabase
      .from("crm_lead_links")
      .select("lead_id")
      .eq("organization_id", organizationId)
      .eq("target_kind", ALVO_DE_VINCULO_DO_AGENDAMENTO)
      .eq("target_id", appointmentId)
      .order("created_at", { ascending: true })
      .limit(1),
    supabase
      .from("calendar_appointment_professionals")
      .select("professional_id, role")
      .eq("organization_id", organizationId)
      .eq("appointment_id", appointmentId),
  ]);

  const erroApoio = tipo.error ?? contato.error ?? lead.error ?? parts.error;
  if (erroApoio)
    return { ok: false, codigo: "erro_interno", motivoParaOperador: erroApoio.message };

  const papeis = new Map<string, PapelDoProfissional>(
    ((parts.data ?? []) as { professional_id: string; role: string }[]).map((p) => [
      String(p.professional_id),
      papelDe(p.role),
    ]),
  );

  let profissionais: (ProfissionalResumo & { papel: PapelDoProfissional })[] = [];
  if (papeis.size > 0) {
    const { data: profs, error: erroProfs } = await supabase
      .from("calendar_professionals")
      .select("id, name, trilha, user_id, is_active")
      .eq("organization_id", organizationId)
      .in("id", [...papeis.keys()]);
    if (erroProfs)
      return { ok: false, codigo: "erro_interno", motivoParaOperador: erroProfs.message };
    profissionais = (
      (profs ?? []) as {
        id: string;
        name: string;
        trilha: number | null;
        user_id: string | null;
        is_active: boolean;
      }[]
    )
      .map((p) => ({
        id: String(p.id),
        nome: String(p.name),
        trilha: trilhaDe(p.trilha),
        userId: p.user_id ? String(p.user_id) : null,
        ativo: Boolean(p.is_active),
        papel: papeis.get(String(p.id)) ?? "apoio",
      }))
      // Principal primeiro: é quem a gaveta nomeia em destaque.
      .sort(
        (a, b) => PAPEIS_DO_PROFISSIONAL.indexOf(a.papel) - PAPEIS_DO_PROFISSIONAL.indexOf(b.papel),
      );
  }

  const linhaTipo = tipo.data as { id: string; name: string } | null;
  const linhaContato = contato.data as {
    id: string;
    name: string | null;
    display_name: string | null;
    phone_number: string | null;
  } | null;
  const linhaLead = ((lead.data ?? []) as { lead_id: string }[])[0];

  return {
    ok: true,
    detalhe: {
      id: String(ag.id),
      titulo: String(ag.title),
      iniciaEm: String(ag.starts_at),
      terminaEm: String(ag.ends_at),
      fuso: String(ag.time_zone),
      situacao: String(ag.status),
      origem: origemDe(ag.source),
      autor: autorDe(ag.created_by_kind),
      notas: ag.notes ? String(ag.notes) : null,
      motivoDoCancelamento: ag.cancellation_reason ? String(ag.cancellation_reason) : null,
      tipo: linhaTipo ? { id: String(linhaTipo.id), nome: String(linhaTipo.name) } : null,
      contato: linhaContato
        ? {
            id: String(linhaContato.id),
            nome: nomeDoContato(linhaContato),
            telefone: linhaContato.phone_number ?? null,
          }
        : null,
      profissionais,
      conversaId: ag.conversation_id ? String(ag.conversation_id) : null,
      leadId: linhaLead ? String(linhaLead.lead_id) : null,
      lembrete: {
        enviadoEm: ag.reminder_sent_at ? String(ag.reminder_sent_at) : null,
        puladoPor: ag.reminder_skipped_reason ? String(ag.reminder_skipped_reason) : null,
        mensagemAgendadaId: ag.reminder_scheduled_message_id
          ? String(ag.reminder_scheduled_message_id)
          : null,
      },
    },
  };
}
