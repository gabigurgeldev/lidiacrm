/**
 * O AVISO NA CENTRAL quando a IA mexe na agenda (migration 0245).
 *
 * A equipe precisa saber, sem abrir a grade, que o agente marcou, remarcou ou
 * cancelou um horário — é o pedido do dono do produto ("aviso na Central quando
 * a IA marca"). Humano que marca pela tela não gera aviso: ele já sabe o que fez,
 * e aviso que ninguém precisa ler ensina a equipe a não ler a Central.
 *
 * ─── Forma ──────────────────────────────────────────────────────────────────
 *
 * `agent_inbox_items.kind = 'other'` + `ref_kind = 'calendar_appointment'`, o
 * mesmo padrão de `lib/mensagem-agendada/supabase.ts`: o CHECK de `kind` é
 * fechado, e a identidade real vai no ponteiro. O clique na Central leva a
 * `/app/agenda?agendamento=<id>` (quem roteia é `AgentInboxList`, pela MESMA
 * constante `REF_KIND_DO_AGENDAMENTO`).
 *
 * ─── Data no texto ──────────────────────────────────────────────────────────
 *
 * Absoluta e no fuso DO AGENDAMENTO (`time_zone`), nunca "amanhã": o aviso é
 * lido horas depois de nascer, e um relativo envelhece na Central. O texto é
 * conteúdo gravado (não interface), e sai pela régua de `partesNoFuso`.
 *
 * ⚠️ NUNCA LANÇA. O aviso descreve a mutação; não pode derrubá-la.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

import { partesNoFuso } from "./fuso";
import { REF_KIND_DO_AGENDAMENTO } from "./tipos";

export type AcaoDaIaNaAgenda = "marcou" | "remarcou" | "cancelou";

export interface ConteudoDoAviso {
  acao: AcaoDaIaNaAgenda;
  servico: string | null;
  cliente: string | null;
  iniciaEm: Date;
  fuso: string;
  /** Na ordem: principal primeiro. */
  profissionais: string[];
  /** Só em `remarcou`: de onde saiu. */
  iniciavaEm?: Date | null;
  /** Só em `cancelou`. */
  motivo?: string | null;
}

const dois = (n: number) => String(n).padStart(2, "0");

/** `02/09/2026 às 10:00` — no fuso pedido, sem depender do idioma da máquina. */
export function dataHoraNoFuso(instante: Date, fuso: string): string {
  const p = partesNoFuso(instante, fuso);
  return `${dois(p.dia)}/${dois(p.mes)}/${p.ano} às ${dois(p.hora)}:${dois(p.minuto)}`;
}

function listaDeNomes(nomes: string[]): string {
  if (nomes.length <= 1) return nomes[0] ?? "";
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/** Título e corpo do aviso — puro, para o texto ser testado sem banco. */
export function textoDoAviso(c: ConteudoDoAviso): { titulo: string; corpo: string } {
  const servico = c.servico?.trim() || "Agendamento";
  const cliente = c.cliente?.trim() || "cliente sem nome";
  const quando = dataHoraNoFuso(c.iniciaEm, c.fuso);

  const verbo = { marcou: "marcou", remarcou: "remarcou", cancelou: "cancelou" }[c.acao];
  const titulo = `A IA ${verbo} ${servico} — ${cliente}`;

  const linhas: string[] = [];
  if (c.acao === "remarcou" && c.iniciavaEm) {
    linhas.push(`De ${dataHoraNoFuso(c.iniciavaEm, c.fuso)} para ${quando} (${c.fuso}).`);
  } else {
    linhas.push(`${c.acao === "cancelou" ? "Era em" : "Em"} ${quando} (${c.fuso}).`);
  }
  if (c.profissionais.length > 0) {
    linhas.push(`Com ${listaDeNomes(c.profissionais)}.`);
  }
  if (c.acao === "cancelou" && c.motivo?.trim()) {
    linhas.push(`Motivo: ${c.motivo.trim()}`);
  }
  return { titulo: titulo.slice(0, 200), corpo: linhas.join("\n") };
}

/**
 * Lê o que o aviso precisa dizer e abre o item na Central.
 *
 * Lê do banco em vez de receber pronto porque quem chama (o handler) não tem os
 * NOMES à mão — só ids. Cinco leituras pequenas, todas com `organization_id`, e
 * só no caminho da IA.
 */
export async function avisarMarcacaoDaIa(
  supabase: SupabaseClient,
  args: {
    organizationId: string;
    appointmentId: string;
    acao: AcaoDaIaNaAgenda;
    iniciavaEm?: string | null;
    motivo?: string | null;
  },
): Promise<void> {
  const org = args.organizationId;
  try {
    const { data: ag, error: erroAg } = await supabase
      .from("calendar_appointments")
      .select("id, title, starts_at, time_zone, event_type_id, contact_id")
      .eq("organization_id", org)
      .eq("id", args.appointmentId)
      .maybeSingle();
    if (erroAg) throw new Error(erroAg.message);
    if (!ag) return;
    const agendamento = ag as {
      id: string;
      title: string | null;
      starts_at: string;
      time_zone: string;
      event_type_id: string | null;
      contact_id: string | null;
    };

    const [tipo, contato, participantes] = await Promise.all([
      agendamento.event_type_id
        ? supabase
            .from("calendar_event_types")
            .select("name")
            .eq("organization_id", org)
            .eq("id", agendamento.event_type_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      agendamento.contact_id
        ? supabase
            .from("contacts")
            .select("name, display_name")
            .eq("organization_id", org)
            .eq("id", agendamento.contact_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("calendar_appointment_professionals")
        .select("professional_id, role")
        .eq("organization_id", org)
        .eq("appointment_id", agendamento.id),
    ]);

    const papeis = ((participantes.data ?? []) as { professional_id: string; role: string }[]).sort(
      (a, b) => (a.role === "principal" ? -1 : 0) - (b.role === "principal" ? -1 : 0),
    );
    let nomes: string[] = [];
    if (papeis.length > 0) {
      const { data: profs } = await supabase
        .from("calendar_professionals")
        .select("id, name")
        .eq("organization_id", org)
        .in(
          "id",
          papeis.map((p) => p.professional_id),
        );
      const porId = new Map(((profs ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
      nomes = papeis.map((p) => porId.get(p.professional_id)).filter((n): n is string => Boolean(n));
    }

    const c = contato.data as { name: string | null; display_name: string | null } | null;
    const { titulo, corpo } = textoDoAviso({
      acao: args.acao,
      servico: (tipo.data as { name: string } | null)?.name ?? agendamento.title,
      cliente: c?.name ?? c?.display_name ?? null,
      iniciaEm: new Date(agendamento.starts_at),
      fuso: agendamento.time_zone,
      profissionais: nomes,
      iniciavaEm: args.iniciavaEm ? new Date(args.iniciavaEm) : null,
      motivo: args.motivo ?? null,
    });

    const { error } = await supabase.from("agent_inbox_items").insert({
      organization_id: org,
      kind: "other",
      severity: "info",
      title: titulo,
      body: corpo,
      ref_kind: REF_KIND_DO_AGENDAMENTO,
      ref_id: agendamento.id,
      status: "open",
    });
    if (error) throw new Error(error.message);
  } catch (err) {
    logger.warn("agenda: não consegui abrir o aviso da IA na Central", {
      organization_id: org,
      appointment_id: args.appointmentId,
      acao: args.acao,
      erro: err instanceof Error ? err.message : String(err),
    });
  }
}
