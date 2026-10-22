/**
 * Leitura e escrita comuns de `/api/v1/agenda/profissionais` e `/[id]`.
 *
 * O client é o ADMIN (service role, bypassa a RLS) — quem autoriza é a rota, com
 * `requireRole`. Por isso TODA query aqui filtra `organization_id`, que a rota
 * tira do cookie validado e nunca do corpo (anti-pattern nº 10 do CLAUDE.md).
 *
 * ─── De onde vem a jornada ───────────────────────────────────────────────────
 *
 * Duas fontes, nunca as duas ao mesmo tempo (CHECK
 * `calendar_professionals_jornada_tem_uma_fonte`):
 *
 *   · com login (`user_id`) → `attendant_availability.schedule` do membro — a
 *     MESMA que Equipe › Atendimento edita; `jornada_fonte = 'membro'`;
 *   · sem login → `calendar_professionals.schedule`; `jornada_fonte = 'propria'`.
 *
 * Editar a jornada por aqui grava no lugar certo dos dois casos.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { AvailabilitySchedule } from "@/lib/schemas/routing";

export interface ItemDaProfissional {
  id: string;
  nome: string;
  trilha: number | null;
  ativo: boolean;
  user_id: string | null;
  jornada: unknown;
  jornada_fonte: "membro" | "propria";
  tipos: string[];
}

interface Linha {
  id: string;
  name: string;
  trilha: number | null;
  is_active: boolean;
  user_id: string | null;
  schedule: unknown;
  position: number;
}

export const COLUNAS_DA_PROFISSIONAL = "id, name, trilha, is_active, user_id, schedule, position";

/** Uma recusa já com status e código de wire — a rota a traduz com `fail()`. */
export class RecusaDaProfissional extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "RecusaDaProfissional";
  }
}

/** Os itens, na ordem de exibição (position, nome). `ids` ausente = todas da org. */
export async function itensDasProfissionais(
  admin: SupabaseClient,
  organizationId: string,
  ids?: string[],
): Promise<ItemDaProfissional[]> {
  let q = admin.from("calendar_professionals").select(COLUNAS_DA_PROFISSIONAL).eq("organization_id", organizationId);
  if (ids) q = q.in("id", ids);
  const { data, error } = await q.order("position").order("name");
  if (error) throw new Error(error.message);
  const linhas = (data ?? []) as Linha[];
  if (linhas.length === 0) return [];

  const usuarios = linhas.map((l) => l.user_id).filter((u): u is string => Boolean(u));
  const [habilitacoes, disponibilidades] = await Promise.all([
    admin
      .from("calendar_event_type_professionals")
      .select("professional_id, event_type_id")
      .eq("organization_id", organizationId)
      .in(
        "professional_id",
        linhas.map((l) => l.id),
      ),
    usuarios.length > 0
      ? admin
          .from("attendant_availability")
          .select("user_id, schedule")
          .eq("organization_id", organizationId)
          .in("user_id", usuarios)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (habilitacoes.error) throw new Error(habilitacoes.error.message);
  if (disponibilidades.error) throw new Error(disponibilidades.error.message);

  const tiposPorProfissional = new Map<string, string[]>();
  for (const h of (habilitacoes.data ?? []) as { professional_id: string; event_type_id: string }[]) {
    const lista = tiposPorProfissional.get(h.professional_id) ?? [];
    lista.push(h.event_type_id);
    tiposPorProfissional.set(h.professional_id, lista);
  }
  const jornadaDoMembro = new Map(
    ((disponibilidades.data ?? []) as { user_id: string; schedule: unknown }[]).map((d) => [d.user_id, d.schedule]),
  );

  return linhas.map((l) => ({
    id: l.id,
    nome: l.name,
    trilha: l.trilha,
    ativo: l.is_active,
    user_id: l.user_id,
    jornada: l.user_id ? (jornadaDoMembro.get(l.user_id) ?? null) : (l.schedule ?? null),
    jornada_fonte: l.user_id ? "membro" : "propria",
    tipos: (tiposPorProfissional.get(l.id) ?? []).sort(),
  }));
}

/** A linha da profissional, ou `null` — sempre com o filtro de organização. */
export async function linhaDaProfissional(
  admin: SupabaseClient,
  organizationId: string,
  id: string,
): Promise<Linha | null> {
  const { data, error } = await admin
    .from("calendar_professionals")
    .select(COLUNAS_DA_PROFISSIONAL)
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Linha | null) ?? null;
}

/**
 * O membro pode virar profissional desta organização? Tem de ser membro ATIVO
 * (senão daria agenda aqui a usuário de outra org) e não estar vinculado a outra
 * profissional (o índice `calendar_professionals_membro_key` recusaria — melhor
 * recusar antes, dizendo quem).
 */
export async function exigeMembroLivre(
  admin: SupabaseClient,
  organizationId: string,
  userId: string,
  exceto?: string,
): Promise<void> {
  const [{ data: membro, error: erroMembro }, { data: vinculada, error: erroVinculo }] = await Promise.all([
    admin
      .from("user_organizations")
      .select("user_id, revoked_at")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .maybeSingle(),
    admin
      .from("calendar_professionals")
      .select("id, name")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  if (erroMembro) throw new Error(erroMembro.message);
  if (erroVinculo) throw new Error(erroVinculo.message);
  const m = membro as { revoked_at: string | null } | null;
  if (!m || m.revoked_at !== null) {
    throw new RecusaDaProfissional(422, "agenda_profissional_invalido", "Este usuário não é membro ativo da organização.");
  }
  const v = vinculada as { id: string; name: string } | null;
  if (v && v.id !== exceto) {
    throw new RecusaDaProfissional(409, "state_conflict", `Este membro já está vinculado à profissional "${v.name}".`);
  }
}

/** Todos os tipos pertencem à organização? Senão 422, sem dizer de quem são. */
export async function exigeTiposDaOrg(
  admin: SupabaseClient,
  organizationId: string,
  tipos: string[],
): Promise<void> {
  const unicos = [...new Set(tipos)];
  if (unicos.length === 0) return;
  const { data, error } = await admin
    .from("calendar_event_types")
    .select("id")
    .eq("organization_id", organizationId)
    .in("id", unicos);
  if (error) throw new Error(error.message);
  if ((data ?? []).length !== unicos.length) {
    throw new RecusaDaProfissional(422, "validation_failed", "Algum dos serviços informados não existe nesta organização.");
  }
}

/**
 * TIRAR A ÚLTIMA HABILITAÇÃO DE UM SERVIÇO É RECUSADO.
 *
 * Tipo sem habilitação nenhuma é "aberto": qualquer profissional ativa serve
 * (a regra de instalação antiga, no marcar e na consulta). Então desmarcar a
 * única profissional de um serviço não o deixa "sem ninguém" — o deixa com
 * TODO MUNDO, e a IA passa a oferecer horário de quem nunca fez aquilo. Quem
 * opera não tem como adivinhar isso pela tela; a recusa diz o que fazer.
 *
 * Mede pelo conjunto CRU (ativas ou não): é a mesma régua que decide se o tipo
 * é fechado. Lança `RecusaDaProfissional` 422 — chame ANTES de qualquer escrita,
 * para a recusa não chegar depois de metade do pedido gravada.
 */
export async function exigeServicosNaoFicamSemProfissional(
  admin: SupabaseClient,
  organizationId: string,
  professionalId: string,
  tipos: string[],
): Promise<void> {
  const ficam = new Set(tipos);
  const { data: atuais, error: erroAtuais } = await admin
    .from("calendar_event_type_professionals")
    .select("event_type_id")
    .eq("organization_id", organizationId)
    .eq("professional_id", professionalId);
  if (erroAtuais) throw new Error(erroAtuais.message);
  const saindo = [
    ...new Set(((atuais ?? []) as { event_type_id: string }[]).map((l) => String(l.event_type_id))),
  ].filter((t) => !ficam.has(t));
  if (saindo.length === 0) return;

  const { data: outras, error: erroOutras } = await admin
    .from("calendar_event_type_professionals")
    .select("event_type_id")
    .eq("organization_id", organizationId)
    .in("event_type_id", saindo)
    .neq("professional_id", professionalId);
  if (erroOutras) throw new Error(erroOutras.message);
  const comOutra = new Set(((outras ?? []) as { event_type_id: string }[]).map((l) => String(l.event_type_id)));
  const orfaos = saindo.filter((t) => !comOutra.has(t));
  if (orfaos.length === 0) return;

  const { data: nomes } = await admin
    .from("calendar_event_types")
    .select("id, name")
    .eq("organization_id", organizationId)
    .in("id", orfaos);
  const nome = ((nomes ?? []) as { id: string; name: string }[]).find((n) => n.id === orfaos[0])?.name;
  const servico = nome ? `O serviço "${nome}"` : "Um dos serviços";
  throw new RecusaDaProfissional(
    422,
    "validation_failed",
    `${servico} ficaria sem nenhuma profissional — habilite outra antes de tirar esta.`,
  );
}

/**
 * Substitui o conjunto de serviços que a profissional atende. Recusa (422)
 * quando isso deixaria algum serviço sem profissional nenhuma — ver
 * `exigeServicosNaoFicamSemProfissional`.
 */
export async function gravarTiposDaProfissional(
  admin: SupabaseClient,
  organizationId: string,
  professionalId: string,
  tipos: string[],
): Promise<void> {
  await exigeServicosNaoFicamSemProfissional(admin, organizationId, professionalId, tipos);
  const unicos = [...new Set(tipos)];
  // Acrescenta antes de tirar: entre as duas escritas, a profissional tem o
  // conjunto novo MAIS o velho — nunca nenhum (que tiraria horários da oferta).
  if (unicos.length > 0) {
    const { error } = await admin.from("calendar_event_type_professionals").upsert(
      unicos.map((event_type_id) => ({
        organization_id: organizationId,
        event_type_id,
        professional_id: professionalId,
      })),
      { onConflict: "event_type_id,professional_id", ignoreDuplicates: true },
    );
    if (error) throw new Error(error.message);
  }
  let apaga = admin
    .from("calendar_event_type_professionals")
    .delete()
    .eq("organization_id", organizationId)
    .eq("professional_id", professionalId);
  if (unicos.length > 0) apaga = apaga.not("event_type_id", "in", `(${unicos.join(",")})`);
  const { error: erroApaga } = await apaga;
  if (erroApaga) throw new Error(erroApaga.message);
}

/** A jornada do MEMBRO — upsert por `(organization_id, user_id)`, como a tela de Equipe faz. */
export async function gravarJornadaDoMembro(
  admin: SupabaseClient,
  organizationId: string,
  userId: string,
  jornada: AvailabilitySchedule,
): Promise<void> {
  const { error } = await admin.from("attendant_availability").upsert(
    {
      organization_id: organizationId,
      user_id: userId,
      schedule: jornada,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,user_id" },
  );
  if (error) throw new Error(error.message);
}
