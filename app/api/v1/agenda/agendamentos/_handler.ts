/**
 * A REGRA de marcar, remarcar e cancelar — fora da rota, de propósito.
 *
 * ⚠️ UMA FERRAMENTA MCP NÃO CHAMA ROTA NEXT. Não há `request`, não há cookie, e
 * a rota devolve `Response` em vez de dado. Por isso este repo tem o padrão do
 * `_handler` — messages, conversations, contacts, leads e pipelines já o usam: a
 * regra mora aqui, e a ROTA e a TOOL chamam a mesma função. A agenda era a
 * exceção, com a regra inline na rota, e por isso as três ferramentas de escrita
 * do agente não tinham o que embrulhar.
 *
 * ⚠️ A ORGANIZAÇÃO ENTRA POR PARÂMETRO (`ctx.organization_id`), nunca resolvida
 * aqui. Quem chama é que sabe de onde ela vem: a rota tira do cookie validado, a
 * tool tira do contexto do agente. Se este arquivo lesse cookie, deixaria de
 * servir à tool — que é o motivo de ele existir.
 *
 * ⚠️ E O `organization_id` VAI EM TODA QUERY. Pelo MCP o client é service-role e
 * a RLS não vale: sem o filtro explícito, a leitura entregaria ao modelo
 * compromisso de outra organização — e ler não devolve erro, então nada
 * quebraria; o agente só passaria a "saber" coisas que não são da casa dele.
 *
 * A recusa sai como `ApiError`: a rota a traduz em `fail()`, a tool a traduz
 * para o modelo, e nenhum dos dois reimplementa a decisão.
 *
 * ─── Profissionais (migration 0245) ─────────────────────────────────────────
 *
 * Todo agendamento tem 1 ou 2 profissionais (`calendar_appointment_professionals`):
 * a principal e, quando o tipo pede duas, a apoio. A gravação é ATÔMICA, pela
 * `fn_agenda_marcar` — agendamento e participantes na mesma transação. As
 * unicidades de horário (`calendar_appointments` por dono, e por profissional em
 * `cap_sem_duplicata_idx`) são a última palavra: duas marcações simultâneas no
 * mesmo horário passam ambas pela consulta, e a segunda morre com 23505, que vira
 * 409 `agenda_horario_ocupado` — nunca 500.
 */
import { avisarMarcacaoDaIa } from "@/lib/agenda/aviso-da-marcacao";
import { horariosLivresDaOrg } from "@/lib/agenda/consulta";
import type { MarcarInput, OpcaoDeProfissionais, ProfissionalResumo } from "@/lib/agenda/contrato";
import {
  atividadeDaTransicao,
  autorParaTimeline,
  precisaEmpurrarAoGoogle,
  type SituacaoAnterior,
  type Transicao,
} from "@/lib/agenda/laco";
import { cancelarLembretePendente } from "@/lib/agenda/lembrete-pendente";
import { garantirProfissionalDoMembro, MembroForaDaOrganizacaoError } from "@/lib/agenda/profissionais";
import { ALVO_DE_VINCULO_DO_AGENDAMENTO, VINCULO_DE_AGENDAMENTO } from "@/lib/agenda/tipos";
import { ApiError } from "@/lib/api/types";
import type { Actor, HandlerCtx } from "@/lib/api/handlers/types";
import { audit } from "@/lib/audit";
import { resolveActiveLeadForContact, type LeadCandidate } from "@/lib/leads/active-lead";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { registraFalhaDeAtividade } from "@/lib/leads/activity-write-failure";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

type SB = SupabaseClient;

/**
 * O corpo de "marcar" mora no contrato compartilhado (`lib/agenda/contrato.ts`)
 * e é reexportado aqui: a ferramenta MCP e a rota importam daqui o handler e a
 * forma juntos.
 */
export type { MarcarInput };

/** A recusa da coleta vira código de wire — um mapa, não `if` espalhado. */
const CODIGO_DA_RECUSA = {
  tipo_desconhecido: { status: 404, code: "not_found" },
  tipo_desativado: { status: 422, code: "agenda_tipo_desativado" },
  sem_responsavel: { status: 422, code: "agenda_sem_responsavel" },
  jornada_mal_configurada: { status: 422, code: "agenda_disponibilidade_invalida" },
  profissional_invalido: { status: 422, code: "agenda_profissional_invalido" },
  profissionais_insuficientes: { status: 422, code: "agenda_profissionais_insuficientes" },
  erro_interno: { status: 500, code: "internal_error" },
} as const;

export interface AlterarInput {
  id: string;
  starts_at?: string;
  status?: "confirmed" | "completed" | "no_show";
  notes?: string;
}

export interface CancelarInput {
  id: string;
  reason: string;
}

interface TipoParaMarcar {
  id: string;
  name: string;
  is_active: boolean;
  duration_minutes: number;
  default_owner_user_id: string | null;
  requires_confirmation: boolean;
  location_kind: string;
  location_details: string | null;
  professionals_required?: number | null;
}

/** 1 ou 2 — qualquer outro valor (linha antiga, fixture) vale como 1. */
function necessariosDo(tipo: { professionals_required?: number | null }): 1 | 2 {
  return tipo.professionals_required === 2 ? 2 : 1;
}

export async function marcarAgendamentoHandler(
  supabase: SB,
  ctx: HandlerCtx,
  input: MarcarInput,
): Promise<Record<string, unknown>> {
  const inicio = new Date(input.starts_at);

  const { data: tipoLido, error: erroTipo } = await supabase
    .from("calendar_event_types")
    .select(
      "id, name, is_active, duration_minutes, default_owner_user_id, requires_confirmation, location_kind, location_details, professionals_required",
    )
    .eq("organization_id", ctx.organization_id)
    .eq("id", input.event_type_id)
    .maybeSingle();
  if (erroTipo) throw new ApiError(500, "internal_error", undefined, ctx.requestId, erroTipo.message);
  const tipo = tipoLido as TipoParaMarcar | null;
  if (!tipo) {
    throw new ApiError(404, "not_found", undefined, ctx.requestId, "Tipo de agendamento não encontrado.");
  }
  if (!tipo.is_active) {
    throw new ApiError(422, "agenda_tipo_desativado", undefined, ctx.requestId, `"${tipo.name}" está desativado.`);
  }

  // O `contact_id` É INPUT EXTERNO E PRECISA SER RESOLVIDO, não repassado.
  //
  // ⚠️ Ele atravessava a borda cru: a ferramenta MCP aceita `z.string().uuid()`
  // livre do modelo, e o INSERT o gravava sem perguntar de quem é. Este handler
  // roda com service role e filtra `organization_id` em toda query — `contact_id`
  // era o ÚNICO campo de entrada que não era resolvido. O contato é "quem recebe
  // o LEMBRETE": sem esta checagem, a organização A mandaria WhatsApp para o
  // cliente da B.
  //
  // O molde é o de `app/api/v1/messages/_handler.ts` — resolver contra a org e
  // recusar com 404, sem dizer se o id existe noutro lugar. Roda ANTES de
  // qualquer outra recusa que possa sair como 404 (o invariante
  // `agenda-mcp-nao-alcanca-contato-alheio` depende desta ordem).
  let contatoId: string | null = input.contact_id ?? null;
  if (contatoId) {
    const { data: contato, error: erroContato } = await supabase
      .from("contacts")
      .select("id")
      .eq("id", contatoId)
      .eq("organization_id", ctx.organization_id)
      .maybeSingle();
    if (erroContato) {
      throw new ApiError(500, "internal_error", undefined, ctx.requestId, erroContato.message);
    }
    if (!contato) {
      throw new ApiError(404, "not_found", undefined, ctx.requestId, "Contato não encontrado.");
    }
  }

  // A CONVERSA é a mesma classe de input: ela decide por onde sai o lembrete.
  // Tem de ser da organização E daquele contato — uma conversa de outro cliente
  // mandaria o lembrete para a pessoa errada. Sem contato no corpo, a conversa
  // define quem é atendido.
  const conversaId: string | null = input.conversation_id ?? null;
  if (conversaId) {
    const { data: conversa, error: erroConversa } = await supabase
      .from("conversations")
      .select("id, contact_id")
      .eq("id", conversaId)
      .eq("organization_id", ctx.organization_id)
      .maybeSingle();
    if (erroConversa) {
      throw new ApiError(500, "internal_error", undefined, ctx.requestId, erroConversa.message);
    }
    const daConversa = (conversa as { id: string; contact_id: string | null } | null)?.contact_id ?? null;
    if (!conversa || (contatoId && daConversa !== contatoId)) {
      throw new ApiError(404, "not_found", undefined, ctx.requestId, "Conversa não encontrada para este contato.");
    }
    contatoId = contatoId ?? daConversa;
  }

  const necessarios = necessariosDo(tipo);
  const pedido = await resolverPedidoDeProfissionais(supabase, ctx, tipo, necessarios, input);

  const fim = new Date(inicio.getTime() + tipo.duration_minutes * 60_000);
  const consulta = await exigeHorarioLivre(supabase, ctx, {
    eventTypeId: tipo.id,
    profissionalIds: pedido.consultar,
    ignorarAgendamentoId: null,
    inicio,
    fim,
    casa: pedido.casa,
  });

  const profissionalIds = [consulta.opcao.principalId, consulta.opcao.apoioId].filter(
    (x): x is string => Boolean(x),
  );
  if (profissionalIds.length !== necessarios) {
    throw new ApiError(
      422,
      "agenda_profissionais_insuficientes",
      undefined,
      ctx.requestId,
      `"${tipo.name}" pede ${necessarios} profissionais, e este horário não tem ${necessarios} livres.`,
    );
  }
  const donoId = await userIdDaPrincipal(supabase, ctx, consulta.opcao.principalId, consulta.profissionais);

  const compromisso = {
    event_type_id: tipo.id,
    title: input.title ?? tipo.name,
    starts_at: inicio.toISOString(),
    ends_at: fim.toISOString(),
    // O fuso do compromisso é campo de primeira classe: é o da JORNADA, onde
    // o horário foi decidido, e ele viaja até o lembrete (ACHADO 09).
    time_zone: consulta.fusoDaRegra,
    status: tipo.requires_confirmation ? "pending" : "confirmed",
    // = o `user_id` da principal (NULL quando ela não tem login): o Google e o
    // índice de duplicata antigo continuam lendo daqui.
    owner_user_id: donoId,
    contact_id: contatoId,
    conversation_id: conversaId,
    location_kind: tipo.location_kind,
    location_details: tipo.location_details,
    notes: input.notes ?? null,
    created_by_kind: autorParaCriacao(ctx.actor),
    created_by_user_id: ctx.actor.type === "user" ? ctx.actor.id : null,
    // `agent_id` (linha de `ai_agents`), NUNCA `id` (que é o run): a coluna tem FK.
    created_by_agent_id: ctx.actor.type === "ai_agent" ? (ctx.actor.agent_id ?? null) : null,
    source: ctx.actor.type === "user" ? "ui" : "mcp",
  };

  const { data: novoId, error: erroMarcar } = await supabase.rpc("fn_agenda_marcar", {
    p_organization_id: ctx.organization_id,
    p_compromisso: compromisso,
    p_profissionais: profissionalIds,
  });
  if (erroMarcar) throw erroDeEscrita(erroMarcar, ctx);
  if (typeof novoId !== "string") {
    throw new ApiError(500, "internal_error", undefined, ctx.requestId, "A marcação não devolveu o id.");
  }

  const { data: criadoLido, error: erroLeitura } = await supabase
    .from("calendar_appointments")
    .select("id, starts_at, ends_at, status, time_zone")
    .eq("organization_id", ctx.organization_id)
    .eq("id", novoId)
    .single();
  if (erroLeitura || !criadoLido) {
    throw new ApiError(500, "internal_error", undefined, ctx.requestId, erroLeitura?.message);
  }
  const criado = criadoLido as { id: string; starts_at: string; ends_at: string; status: string; time_zone: string };

  const transicao: Transicao = criado.status === "pending" ? "pending" : "confirmed";
  await fecharOLaco(supabase, ctx, {
    appointmentId: criado.id,
    contactId: contatoId,
    atividade: atividadeDaTransicao(null, transicao),
    empurrarAoGoogle: precisaEmpurrarAoGoogle(null, transicao),
    fusoDoCompromisso: criado.time_zone,
    nomeDoTipo: tipo.name,
  });

  if (ctx.actor.type === "ai_agent") {
    await avisarMarcacaoDaIa(supabase, {
      organizationId: ctx.organization_id,
      appointmentId: criado.id,
      acao: "marcou",
    });
  }

  void audit({
    action: "agenda.appointment_created",
    ...autoriaDoAudit(ctx.actor),
    organizationId: ctx.organization_id,
    resourceType: "calendar_appointment",
    resourceId: criado.id,
    requestId: ctx.requestId,
    metadata: {
      event_type_id: tipo.id,
      owner_user_id: donoId,
      professional_ids: profissionalIds,
      contact_id: contatoId,
      conversation_id: conversaId,
      time_zone: criado.time_zone,
    },
  });

  return { ...criado, professional_ids: profissionalIds };
}

/**
 * ⚠️ REMARCAR NÃO É CANCELAR MAIS CRIAR — é a MESMA linha mudando de horário.
 *
 * 1. A TIMELINE conta a história certa. Cancelar+criar emitiria
 *    `appointment_cancelled` seguido de `appointment_scheduled`: duas linhas
 *    dizendo que o cliente desistiu e voltou, quando ele só mudou de horário.
 * 2. O ESPELHO NO GOOGLE é atualizado, não destruído e refeito.
 * 3. O `id` que o cliente já recebeu continua valendo.
 *
 * As MESMAS profissionais seguem atendendo (trocar profissional num agendamento
 * existente não é suportado): a consulta pergunta por elas, e o trigger
 * `fn_agenda_participantes_acompanham` move o horário delas no mesmo UPDATE —
 * um choque ali também é 23505, e também vira 409.
 */
export async function alterarAgendamentoHandler(
  supabase: SB,
  ctx: HandlerCtx,
  input: AlterarInput,
): Promise<Record<string, unknown>> {
  const atual = await exigeAgendamento(supabase, ctx, input.id, [
    "id",
    "event_type_id",
    "owner_user_id",
    "contact_id",
    "starts_at",
    "status",
    "time_zone",
  ]);

  if (atual.status === "cancelled") {
    throw new ApiError(
      422,
      "agenda_ja_cancelado",
      undefined,
      ctx.requestId,
      "Este agendamento foi cancelado. Marque um novo em vez de reabrir este.",
    );
  }

  const mudanca: Record<string, unknown> = {};
  if (input.notes !== undefined) mudanca.notes = input.notes;
  let transicao: Transicao | null = null;

  if (input.starts_at) {
    const novoInicio = new Date(input.starts_at);
    const { data: tipo } = await supabase
      .from("calendar_event_types")
      .select("id, duration_minutes")
      .eq("organization_id", ctx.organization_id)
      .eq("id", (atual.event_type_id as string | null) ?? "")
      .maybeSingle();
    if (!tipo) {
      throw new ApiError(404, "not_found", undefined, ctx.requestId, "O tipo deste agendamento não existe mais.");
    }

    const novoFim = new Date(novoInicio.getTime() + tipo.duration_minutes * 60_000);
    // Remarcar para o mesmo instante é no-op: não há o que perguntar à agenda.
    const mesmoHorario = new Date(atual.starts_at as string).getTime() === novoInicio.getTime();
    if (!mesmoHorario) {
      const participantes = await participantesDo(supabase, ctx, atual.id as string);
      const principal = participantes.find((p) => p.role === "principal")?.professional_id ?? null;
      const apoio = participantes.find((p) => p.role === "apoio")?.professional_id ?? null;

      const consulta = await exigeHorarioLivre(supabase, ctx, {
        eventTypeId: tipo.id,
        profissionalIds: principal ? [principal, ...(apoio ? [apoio] : [])] : null,
        ownerUserId: principal ? null : ((atual.owner_user_id as string | null) ?? null),
        // ⚠️ O PRÓPRIO AGENDAMENTO OCUPA O HORÁRIO ANTIGO. Sem ignorá-lo, mover
        // 30 min para frente uma consulta de 1 h colidia consigo mesma e era
        // recusada — só o "mesmo instante" era tratado.
        ignorarAgendamentoId: atual.id as string,
        inicio: novoInicio,
        fim: novoFim,
        casa: principal ? (o) => o.principalId === principal && (!apoio || o.apoioId === apoio) : null,
      });
      mudanca.starts_at = novoInicio.toISOString();
      mudanca.ends_at = novoFim.toISOString();
      mudanca.time_zone = consulta.fusoDaRegra;
      transicao = "rescheduled";
    }
  }

  if (input.status && input.status !== atual.status) {
    mudanca.status = input.status;
    // Remarcar vence: se vieram os dois, a notícia da timeline é a remarcação.
    transicao = transicao ?? input.status;
  }

  if (Object.keys(mudanca).length === 0) return { id: atual.id, inalterado: true };

  const { data: salvo, error: erroUpdate } = await supabase
    .from("calendar_appointments")
    .update(mudanca)
    .eq("organization_id", ctx.organization_id)
    .eq("id", atual.id as string)
    .select("id, starts_at, ends_at, status, time_zone")
    .single();
  if (erroUpdate) throw erroDeEscrita(erroUpdate, ctx);

  if (transicao === "rescheduled") {
    // O lembrete do horário ANTIGO não pode sair, e o do novo precisa poder.
    await cancelarLembretePendente(supabase, ctx.organization_id, atual.id as string);
  }

  if (transicao) {
    await fecharOLaco(supabase, ctx, {
      appointmentId: atual.id as string,
      contactId: (atual.contact_id as string | null) ?? null,
      atividade: atividadeDaTransicao(atual.status as SituacaoAnterior, transicao),
      empurrarAoGoogle: precisaEmpurrarAoGoogle(atual.status as SituacaoAnterior, transicao),
      fusoDoCompromisso: salvo.time_zone,
      nomeDoTipo: "Agendamento",
    });

    // ⚠️ `completed` e `no_show` NÃO são auditados, por decisão do maestro: não
    // são mutação de intenção, são registro de fato já consumado, e vivem na
    // timeline. Procurar o tipo de audit deles e não achar é o esperado.
    if (transicao === "rescheduled") {
      if (ctx.actor.type === "ai_agent") {
        await avisarMarcacaoDaIa(supabase, {
          organizationId: ctx.organization_id,
          appointmentId: atual.id as string,
          acao: "remarcou",
          iniciavaEm: atual.starts_at as string,
        });
      }
      void audit({
        action: "agenda.appointment_rescheduled",
        ...autoriaDoAudit(ctx.actor),
        organizationId: ctx.organization_id,
        resourceType: "calendar_appointment",
        resourceId: atual.id as string,
        requestId: ctx.requestId,
        metadata: { de: atual.starts_at, para: salvo.starts_at },
      });
    }
  }

  return salvo as Record<string, unknown>;
}

/**
 * Cancela de verdade (status), não apaga a linha: o histórico do que foi marcado
 * e desmarcado é o que deixa o Radar distinguir lead que desistiu de lead que
 * nunca marcou, e o agente não reoferecer o horário que a pessoa recusou.
 *
 * ⚠️ O MOTIVO É OBRIGATÓRIO — é o que a equipe lê ao ver o horário vago.
 */
export async function cancelarAgendamentoHandler(
  supabase: SB,
  ctx: HandlerCtx,
  input: CancelarInput,
): Promise<Record<string, unknown>> {
  const atual = await exigeAgendamento(supabase, ctx, input.id, [
    "id",
    "contact_id",
    "status",
    "time_zone",
  ]);

  // Idempotente: cancelar o que já está cancelado devolve o estado, não erro —
  // quem chamou queria o compromisso desmarcado, e ele está.
  if (atual.status === "cancelled") {
    return { id: atual.id, status: "cancelled", ja_estava: true };
  }

  const { data: salvo, error: erroUpdate } = await supabase
    .from("calendar_appointments")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancellation_reason: input.reason,
    })
    .eq("organization_id", ctx.organization_id)
    .eq("id", atual.id as string)
    .select("id, status, cancelled_at, cancellation_reason")
    .single();
  if (erroUpdate) throw erroDeEscrita(erroUpdate, ctx);

  // Lembrete de consulta cancelada é o pior lembrete que existe.
  await cancelarLembretePendente(supabase, ctx.organization_id, atual.id as string);

  await fecharOLaco(supabase, ctx, {
    appointmentId: atual.id as string,
    contactId: (atual.contact_id as string | null) ?? null,
    atividade: atividadeDaTransicao(atual.status as SituacaoAnterior, "cancelled"),
    empurrarAoGoogle: precisaEmpurrarAoGoogle(atual.status as SituacaoAnterior, "cancelled"),
    fusoDoCompromisso: atual.time_zone as string,
    nomeDoTipo: "Agendamento",
  });

  if (ctx.actor.type === "ai_agent") {
    await avisarMarcacaoDaIa(supabase, {
      organizationId: ctx.organization_id,
      appointmentId: atual.id as string,
      acao: "cancelou",
      motivo: input.reason,
    });
  }

  void audit({
    action: "agenda.appointment_cancelled",
    ...autoriaDoAudit(ctx.actor),
    organizationId: ctx.organization_id,
    resourceType: "calendar_appointment",
    resourceId: atual.id as string,
    requestId: ctx.requestId,
    metadata: { reason: input.reason },
  });

  return salvo as Record<string, unknown>;
}

/** O compromisso, ou 404 — sempre com o filtro de organização. */
async function exigeAgendamento(
  supabase: SB,
  ctx: HandlerCtx,
  id: string,
  colunas: string[],
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase
    .from("calendar_appointments")
    .select(colunas.join(", "))
    .eq("organization_id", ctx.organization_id)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
  if (!data) {
    throw new ApiError(404, "not_found", undefined, ctx.requestId, "Agendamento não encontrado.");
  }
  return data as unknown as Record<string, unknown>;
}

/** Quem atende hoje este agendamento. */
async function participantesDo(
  supabase: SB,
  ctx: HandlerCtx,
  appointmentId: string,
): Promise<{ professional_id: string; role: string }[]> {
  const { data, error } = await supabase
    .from("calendar_appointment_professionals")
    .select("professional_id, role")
    .eq("organization_id", ctx.organization_id)
    .eq("appointment_id", appointmentId);
  if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
  return (data ?? []) as { professional_id: string; role: string }[];
}

/**
 * O que a consulta deve perguntar, e que opção do instante serve.
 *
 *  · `professional_ids` explícito: valida ANTES de consultar (distintas, na
 *    quantidade que o tipo pede, da organização, ativas e habilitadas no tipo).
 *    Recusar aqui dá ao chamador o motivo certo — sem isto, uma profissional
 *    desativada viraria "horário indisponível", que manda procurar outro horário
 *    quando o problema é a pessoa.
 *  · `owner_user_id` (LEGADO): o membro vira o profissional dele, e ele é a
 *    principal fixa; a apoio, se o tipo pede, sai da 1ª opção livre.
 *  · nada: a 1ª opção livre do instante, na ordem da consulta.
 */
async function resolverPedidoDeProfissionais(
  supabase: SB,
  ctx: HandlerCtx,
  tipo: TipoParaMarcar,
  necessarios: 1 | 2,
  input: MarcarInput,
): Promise<{ consultar: string[] | null; casa: ((o: OpcaoDeProfissionais) => boolean) | null }> {
  const pedidas = input.professional_ids ?? [];

  if (pedidas.length > 0) {
    if (new Set(pedidas).size !== pedidas.length) {
      throw new ApiError(
        422,
        "agenda_profissional_invalido",
        undefined,
        ctx.requestId,
        "A mesma profissional apareceu duas vezes. Principal e apoio são pessoas diferentes.",
      );
    }
    if (pedidas.length < necessarios) {
      throw new ApiError(
        422,
        "agenda_profissionais_insuficientes",
        undefined,
        ctx.requestId,
        `"${tipo.name}" pede ${necessarios} profissionais (principal e apoio); vieram ${pedidas.length}.`,
      );
    }
    if (pedidas.length > necessarios) {
      throw new ApiError(
        422,
        "agenda_profissional_invalido",
        undefined,
        ctx.requestId,
        `"${tipo.name}" é atendido por ${necessarios} profissional${necessarios === 1 ? "" : "is"}; vieram ${pedidas.length}.`,
      );
    }

    const [{ data: linhas, error: erroProf }, { data: habilitacoes, error: erroHab }] = await Promise.all([
      supabase
        .from("calendar_professionals")
        .select("id, name, is_active")
        .eq("organization_id", ctx.organization_id)
        .in("id", pedidas),
      supabase
        .from("calendar_event_type_professionals")
        .select("professional_id")
        .eq("organization_id", ctx.organization_id)
        .eq("event_type_id", tipo.id),
    ]);
    if (erroProf || erroHab) {
      throw new ApiError(500, "internal_error", undefined, ctx.requestId, (erroProf ?? erroHab)?.message);
    }
    const porId = new Map(((linhas ?? []) as { id: string; name: string; is_active: boolean }[]).map((l) => [l.id, l]));
    const habilitadas = new Set(((habilitacoes ?? []) as { professional_id: string }[]).map((h) => h.professional_id));

    for (const id of pedidas) {
      const p = porId.get(id);
      if (!p) {
        throw new ApiError(422, "agenda_profissional_invalido", undefined, ctx.requestId, "Profissional não encontrada.");
      }
      if (!p.is_active) {
        throw new ApiError(
          422,
          "agenda_profissional_invalido",
          undefined,
          ctx.requestId,
          `${p.name} está desativada e não recebe agendamentos.`,
        );
      }
      // Tipo SEM habilitação nenhuma aceita qualquer ativa (instalação antiga);
      // com habilitação, só quem faz este atendimento.
      if (habilitadas.size > 0 && !habilitadas.has(id)) {
        throw new ApiError(
          422,
          "agenda_profissional_invalido",
          undefined,
          ctx.requestId,
          `${p.name} não faz "${tipo.name}".`,
        );
      }
    }

    const [principal, apoio] = pedidas as [string, string | undefined];
    return {
      consultar: pedidas,
      casa: (o) => o.principalId === principal && (o.apoioId ?? null) === (apoio ?? null),
    };
  }

  if (input.owner_user_id) {
    let principal: string;
    try {
      // ⚠️ CLIENT ADMIN, não o recebido. Pela rota ele é o de SESSÃO, e com papel
      // `agent` o INSERT em `calendar_professionals` esbarra na RLS (escrita é
      // manager+) e viraria 500; o nome do membro também só sai por
      // `auth.admin`. A organização continua sendo a do contexto confiável
      // (`ctx.organization_id`), e a função filtra por ela em toda query.
      principal = await garantirProfissionalDoMembro(
        createAdminClient(),
        ctx.organization_id,
        input.owner_user_id,
      );
    } catch (err) {
      if (err instanceof MembroForaDaOrganizacaoError) {
        throw new ApiError(
          422,
          "agenda_profissional_invalido",
          undefined,
          ctx.requestId,
          "O responsável escolhido não é membro ativo desta organização.",
        );
      }
      throw new ApiError(500, "internal_error", undefined, ctx.requestId, (err as Error).message);
    }
    return {
      // Com uma só, a consulta pergunta por ela. Com duas, pergunta pelas
      // habilitadas e fica com a opção em que ela é a principal.
      consultar: necessarios === 1 ? [principal] : null,
      casa: (o) => o.principalId === principal,
    };
  }

  return { consultar: null, casa: null };
}

/**
 * O horário pedido está entre os que esta agenda oferece — e com QUEM?
 *
 * ⚠️ Pela MESMA coleta que responde o GET e as ferramentas de leitura
 * (`horariosLivresDaOrg`), nunca por uma segunda. Duas coletas divergem no
 * primeiro ajuste: a tela oferece horário que a escrita recusa, ou a escrita
 * aceita um que a tela não ofereceu.
 *
 * O instante tem de existir EXATO na lista, e precisa ter uma opção de
 * profissionais que case com o pedido (`casa`); sem pedido, vale a 1ª opção,
 * que a consulta já devolve ordenada.
 */
async function exigeHorarioLivre(
  supabase: SB,
  ctx: HandlerCtx,
  args: {
    eventTypeId: string;
    profissionalIds: string[] | null;
    ownerUserId?: string | null;
    ignorarAgendamentoId: string | null;
    inicio: Date;
    fim: Date;
    casa: ((o: OpcaoDeProfissionais) => boolean) | null;
  },
): Promise<{ fusoDaRegra: string; opcao: OpcaoDeProfissionais; profissionais: ProfissionalResumo[] }> {
  const consulta = await horariosLivresDaOrg(supabase, ctx.organization_id, {
    eventTypeId: args.eventTypeId,
    profissionalIds: args.profissionalIds,
    ownerUserId: args.ownerUserId ?? null,
    ignorarAgendamentoId: args.ignorarAgendamentoId,
    de: args.inicio,
    ate: args.fim,
    agora: new Date(),
  });

  if (!consulta.ok) {
    const { status, code } = CODIGO_DA_RECUSA[consulta.codigo];
    throw new ApiError(status, code, undefined, ctx.requestId, consulta.motivoParaOperador);
  }
  if (!consulta.publicouHorarios) {
    throw new ApiError(
      422,
      "agenda_fora_da_jornada",
      undefined,
      ctx.requestId,
      "Este responsável ainda não publicou horários de atendimento.",
    );
  }
  const slot = consulta.slots.find((s) => s.inicio.getTime() === args.inicio.getTime());
  const opcao = slot ? (args.casa ? slot.opcoes.find(args.casa) : slot.opcoes[0]) : undefined;
  if (!opcao) {
    throw new ApiError(
      422,
      "agenda_horario_indisponivel",
      undefined,
      ctx.requestId,
      "Este horário não está disponível. Consulte os horários livres e escolha outro.",
    );
  }
  return { fusoDaRegra: consulta.fusoDaRegra, opcao, profissionais: consulta.profissionais };
}

/** O `user_id` da principal (NULL se ela não tem login) — vira `owner_user_id`. */
async function userIdDaPrincipal(
  supabase: SB,
  ctx: HandlerCtx,
  principalId: string,
  conhecidas: ProfissionalResumo[],
): Promise<string | null> {
  const conhecida = conhecidas.find((p) => p.id === principalId);
  if (conhecida) return conhecida.userId;
  const { data, error } = await supabase
    .from("calendar_professionals")
    .select("user_id")
    .eq("organization_id", ctx.organization_id)
    .eq("id", principalId)
    .maybeSingle();
  if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
  return (data as { user_id: string | null } | null)?.user_id ?? null;
}

/**
 * O erro de ESCRITA traduzido. 23505 é a corrida perdida — alguém marcou o
 * mesmo horário entre a consulta e a gravação, e a unicidade do banco segurou.
 * É 409 com ensino, não 500: quem chamou pode consultar de novo e escolher outro.
 */
function erroDeEscrita(error: { code?: string; message: string }, ctx: HandlerCtx): ApiError {
  if (error.code === "23505") {
    return new ApiError(
      409,
      "agenda_horario_ocupado",
      undefined,
      ctx.requestId,
      "Este horário acabou de ser ocupado. Consulte os horários livres de novo e escolha outro.",
    );
  }
  // 22023 = argumento recusado pela `fn_agenda_marcar`; 23503 = profissional de
  // outra organização (FK composta). Os dois são "essa profissional não serve".
  if (error.code === "22023" || error.code === "23503") {
    return new ApiError(422, "agenda_profissional_invalido", undefined, ctx.requestId, error.message);
  }
  return new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
}

/** Quem agiu, para o audit: o usuário, ou o token do agente quando há. */
function autoriaDoAudit(actor: Actor): { actorUserId: string | null; actorApiTokenId?: string | null } {
  if (actor.type === "user") return { actorUserId: actor.id };
  if (actor.type === "ai_agent") return { actorUserId: null, actorApiTokenId: actor.api_token_id ?? null };
  return { actorUserId: null };
}

/** `Actor` → o vocabulário de `calendar_appointments.created_by_kind`. */
function autorParaCriacao(actor: Actor): string {
  if (actor.type === "user") return "user";
  if (actor.type === "ai_agent") return "ai";
  return "system";
}

/**
 * Os TRÊS emissores do laço, no mesmo fluxo da mutação.
 *
 * `crm_lead_links` faz o compromisso PERTENCER ao negócio (é por ele que o
 * dossiê o lista); `crm_lead_activities` é o que aparece na TIMELINE; `event_log`
 * é o que leva o compromisso ao Google. Só o vínculo e nada aparece na tela; só
 * a atividade e o dossiê não acha o compromisso.
 *
 * ⚠️ `crm_lead_activities.lead_id` é NOT NULL: agendamento de contato que ainda
 * não virou lead não tem onde ancorar, e o rastro vira `event_log` por
 * `registraFalhaDeAtividade` em vez de sumir. Não se inventa um terceiro caminho.
 */
async function fecharOLaco(
  supabase: SB,
  ctx: HandlerCtx,
  args: {
    appointmentId: string;
    contactId: string | null;
    atividade: string | null;
    empurrarAoGoogle: boolean;
    fusoDoCompromisso: string;
    nomeDoTipo: string;
  },
): Promise<void> {
  if (args.empurrarAoGoogle) {
    // ⚠️ AINDA SEM CONSUMIDOR. `agenda.appointment.push_to_google` não é
    // declarado por handler nenhum, e `drain.ts:54` filtra por
    // `.in("event_type", handledTypes)` — a linha nunca é SELECIONADA e fica
    // `pending` para sempre: não vira `dead`, não conta tentativa, não acende
    // aviso. E não há sonda sobre `event_log` parado. O consumidor é da frente
    // do Google; o contrato e o payload (com o fuso) já estão prontos aqui.
    await supabase.from("event_log").insert({
      organization_id: ctx.organization_id,
      event_type: "agenda.appointment.push_to_google",
      entity_kind: "calendar_appointment",
      entity_id: args.appointmentId,
      payload: { appointment_id: args.appointmentId, time_zone: args.fusoDoCompromisso },
    });
  }

  if (!args.atividade) return;

  const leadId = args.contactId ? await leadAtivoDoContato(supabase, ctx, args.contactId) : null;

  if (!leadId) {
    if (args.contactId) {
      await registraFalhaDeAtividade(supabase, {
        organizationId: ctx.organization_id,
        // Sem negócio não há âncora; o contato é o que se sabe, e vai no lugar
        // do id para o alerta não sair mudo sobre QUEM ficou sem rastro.
        leadId: args.contactId,
        tipo: args.atividade,
        origem: "agenda (sem negócio aberto para ancorar)",
        erro: undefined,
      });
    }
    return;
  }

  await supabase.from("crm_lead_links").insert({
    organization_id: ctx.organization_id,
    lead_id: leadId,
    target_kind: ALVO_DE_VINCULO_DO_AGENDAMENTO,
    target_id: args.appointmentId,
    link_kind: VINCULO_DE_AGENDAMENTO,
    created_by_user_id: ctx.actor.type === "user" ? ctx.actor.id : null,
  });

  await emitLeadActivity(supabase, {
    organizationId: ctx.organization_id,
    leadId,
    contactId: args.contactId,
    type: args.atividade as never,
    sourceModule: "agenda",
    sourceId: args.appointmentId,
    actor: ctx.actor,
    reason: `${args.nomeDoTipo} — ${args.atividade}`,
    // ⚠️ Quem decide o `actor_kind` GRAVADO é `actorParaAtividade(actor)` em
    // `buildLeadActivityRow` (IA com `agent_id` → `ai`; sem → `system`). Este
    // campo é informativo, e `autorParaTimeline` mapeia `ai_agent` → `ai` para
    // ele não contradizer o que a linha diz.
    actorKind: autorParaTimeline(ctx.actor.type),
  } as never);
}

/**
 * O negócio ativo do contato — pela MESMA régua do resto do produto.
 *
 * `resolveActiveLeadForContact` distingue três desfechos que um `limit(2)` não
 * distingue: roteou, `no_open_lead` e `ambiguous_open_leads`. Os dois últimos
 * NÃO são erro: o agendamento existe e a atividade não nasce, porque não há
 * negócio a que ancorar.
 */
async function leadAtivoDoContato(
  supabase: SB,
  ctx: HandlerCtx,
  contactId: string,
): Promise<string | null> {
  const [{ data: candidatos }, { data: padrao }] = await Promise.all([
    supabase
      .from("crm_leads")
      .select("id, organization_id, pipeline_id, status, last_activity_at, created_at")
      .eq("organization_id", ctx.organization_id)
      .eq("contact_id", contactId),
    supabase
      .from("crm_pipelines")
      .select("id")
      .eq("organization_id", ctx.organization_id)
      .eq("is_default", true)
      .eq("is_archived", false)
      .maybeSingle(),
  ]);

  const rota = resolveActiveLeadForContact((candidatos ?? []) as LeadCandidate[], {
    defaultPipelineId: (padrao as { id: string } | null)?.id ?? null,
  });
  return rota.routed ? rota.leadId : null;
}
