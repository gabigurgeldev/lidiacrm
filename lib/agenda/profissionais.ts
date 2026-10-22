/**
 * OS PROFISSIONAIS DA AGENDA — a coleta por pessoa (migration 0245).
 *
 * ─── Por que a coleta é por PROFISSIONAL e não por dono ─────────────────────
 *
 * Até a 0245 a agenda era de quem tem login (`owner_user_id`). Agora toda
 * pessoa agendável é uma linha de `calendar_professionals`, com `user_id`
 * opcional — a esteticista que atende e nunca abre o sistema também tem agenda.
 * Duas fontes de jornada, nunca as duas ao mesmo tempo (a CHECK
 * `calendar_professionals_jornada_tem_uma_fonte` garante):
 *
 * | quem | jornada vem de |
 * |---|---|
 * | com login | `attendant_availability.schedule` (a MESMA do roteamento — nada duplicado) |
 * | sem login | `calendar_professionals.schedule` |
 *
 * E o que ocupa a pessoa chega por duas portas que se sobrepõem — participação
 * (`calendar_appointment_professionals`, principal OU apoio) e o legado por
 * `owner_user_id` (que inclui o que o Google trouxe). `ocupadosDoProfissional`
 * une as duas sem contar duas vezes.
 *
 * ─── EM LOTE, de propósito ─────────────────────────────────────────────────
 *
 * Um tipo com seis profissionais habilitadas faria 6 × 6 consultas se a coleta
 * fosse por pessoa. Aqui são seis consultas no total, cada uma com `.in()`, e a
 * separação por pessoa acontece em memória.
 *
 * ─── ⚠️ O CLIENT PODE SER O ADMIN ──────────────────────────────────────────
 *
 * A ferramenta MCP passa o client de service role, que BYPASSA a RLS. Por isso
 * TODA query aqui filtra `organization_id` explicitamente — mesma regra de
 * `lib/agenda/consulta.ts` (anti-pattern nº 10 do CLAUDE.md). Quem acrescentar
 * query neste arquivo filtra também, sempre.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { ProfissionalResumo } from "./contrato";
import type { ExcecaoDeData, Ocupado } from "./horarios-livres";
import { lerJornadaDoBanco, type LeituraDaJornada } from "./jornada";
import {
  agendaExternaNuncaLida,
  ocupadosDoProfissional,
  type LinhaDeAgendamento,
  type LinhaDeEventoExterno,
} from "./ocupados";
import { TRILHAS_DA_AGENDA, type SituacaoDaConexao, type TrilhaDaAgenda } from "./tipos";

/** O que `jornadaDoProfissional` precisa saber da linha de `calendar_professionals`. */
export interface ProfissionalComJornada {
  /** NULL = sem login: a jornada é `schedule` da própria linha. */
  user_id: string | null;
  /** Só preenchido para quem não tem login (CHECK `calendar_professionals_jornada_tem_uma_fonte`). */
  schedule: unknown;
}

/** A agenda coletada de UMA profissional, pronta para o motor. */
export interface AgendaDoProfissional {
  profissional: ProfissionalResumo;
  /** `calendar_professionals.position` — a ordem de exibição que a operação escolheu. */
  posicao: number;
  leitura: LeituraDaJornada;
  excecoes: ExcecaoDeData[];
  ocupados: Ocupado[];
  fontesDefasadas: SituacaoDaConexao[];
  agendaExternaNuncaLida: boolean;
}

export type ResultadoDaColetaDosProfissionais =
  | { ok: true; agendas: Map<string, AgendaDoProfissional> }
  | { ok: false; motivoParaOperador: string };

/** A linha de `calendar_professionals` que este módulo lê. */
interface LinhaDeProfissional {
  id: string;
  name: string;
  trilha: number | null;
  user_id: string | null;
  is_active: boolean;
  schedule: unknown;
  position: number | string;
}

const COLUNAS_DO_PROFISSIONAL = "id, name, trilha, user_id, is_active, schedule, position";

/** `smallint` 1..8 no banco; qualquer outra coisa vira "sem cor escolhida". */
function trilhaDe(valor: unknown): TrilhaDaAgenda | null {
  const n = Number(valor);
  return (TRILHAS_DA_AGENDA as readonly number[]).includes(n) ? (n as TrilhaDaAgenda) : null;
}

function resumoDe(l: LinhaDeProfissional): ProfissionalResumo {
  return {
    id: String(l.id),
    nome: String(l.name),
    trilha: trilhaDe(l.trilha),
    userId: l.user_id ? String(l.user_id) : null,
    ativo: Boolean(l.is_active),
  };
}

/**
 * A ordem de exibição: `position`, depois nome. É a ordem das opções de cada
 * horário — e a primeira opção é quem "marcar sem escolher" pega —, então ela
 * não pode depender da ordem em que o banco devolveu as linhas.
 */
function ordemDeExibicao(a: LinhaDeProfissional, b: LinhaDeProfissional): number {
  return (
    Number(a.position) - Number(b.position) || String(a.name).localeCompare(String(b.name), "pt-BR")
  );
}

/** `YYYY-MM-DD` de um instante, em UTC — a régua que a coluna `date` usa. */
function diaISO(instante: Date): string {
  return instante.toISOString().slice(0, 10);
}

/**
 * A jornada de uma profissional, PURA.
 *
 * Com login: lê `scheduleDoMembro` (`attendant_availability.schedule`).
 * Sem login: lê `p.schedule`. Os dois pelo MESMO `lerJornadaDoBanco` — então
 * fuso suposto, "não publicou" e jornada corrompida significam a mesma coisa
 * para as duas, e a recusa sai com os mesmos dois textos.
 *
 * A única diferença é ONDE consertar: `lerJornadaDoBanco` manda o operador para
 * Equipe → Atendimento, que é onde mora a jornada de quem tem login. Quem não
 * tem login não está lá — mandar o operador para uma tela onde a pessoa não
 * aparece é recusa que não ensina.
 */
export function jornadaDoProfissional(
  p: ProfissionalComJornada,
  scheduleDoMembro: unknown,
): LeituraDaJornada {
  if (p.user_id) return lerJornadaDoBanco(scheduleDoMembro);

  const leitura = lerJornadaDoBanco(p.schedule);
  if (!leitura.ok && (p.schedule === null || p.schedule === undefined)) {
    return {
      ...leitura,
      motivoParaOperador:
        "ainda não foi configurada. Configure em Configurações → Agenda → Profissionais.",
    };
  }
  return leitura;
}

/**
 * Coleta, em lote (`.in()`), tudo o que o motor precisa das profissionais
 * `ids`: disponibilidade, exceções por `professional_id`, participações,
 * agendamentos por `owner_user_id` (legado/Google), eventos externos e conexões.
 *
 * Id que não é desta organização simplesmente não volta no mapa — quem chama
 * decide se isso é recusa (foi pedido explicitamente) ou nada (veio de uma
 * habilitação que ficou para trás).
 */
export async function carregarAgendasDosProfissionais(
  supabase: SupabaseClient,
  organizationId: string,
  ids: string[],
  opcoes: { de: Date; ate: Date; ignorarAgendamentoId?: string | null },
): Promise<ResultadoDaColetaDosProfissionais> {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return { ok: true, agendas: new Map() };

  const { data: profsRaw, error: erroProfs } = await supabase
    .from("calendar_professionals")
    .select(COLUNAS_DO_PROFISSIONAL)
    .eq("organization_id", organizationId)
    .in("id", unicos);
  if (erroProfs) return { ok: false, motivoParaOperador: erroProfs.message };

  const profissionais = ((profsRaw ?? []) as LinhaDeProfissional[]).sort(ordemDeExibicao);
  if (profissionais.length === 0) return { ok: true, agendas: new Map() };

  const idsAchados = profissionais.map((p) => String(p.id));
  const userIds = [
    ...new Set(profissionais.map((p) => p.user_id).filter((u): u is string => Boolean(u))),
  ];
  const deISO = opcoes.de.toISOString();
  const ateISO = opcoes.ate.toISOString();

  // Quem não tem login não tem disponibilidade de membro, agendamento como dono
  // nem conexão de Google: as consultas por `user_id` só rodam se houver algum.
  const comLogin = userIds.length > 0;
  const vazio = Promise.resolve({ data: [] as unknown[], error: null });

  const [disp, excs, parts, doDono, conexoes] = await Promise.all([
    comLogin
      ? supabase
          .from("attendant_availability")
          .select("user_id, schedule")
          .eq("organization_id", organizationId)
          .in("user_id", userIds)
      : vazio,
    supabase
      .from("calendar_availability_exceptions")
      .select("professional_id, exception_date, is_unavailable, start_minute, end_minute")
      .eq("organization_id", organizationId)
      .in("professional_id", idsAchados)
      .gte("exception_date", diaISO(opcoes.de))
      .lte("exception_date", diaISO(opcoes.ate)),
    supabase
      .from("calendar_appointment_professionals")
      .select("appointment_id, professional_id, starts_at, ends_at, status")
      .eq("organization_id", organizationId)
      .in("professional_id", idsAchados)
      .lt("starts_at", ateISO)
      .gt("ends_at", deISO),
    comLogin
      ? supabase
          .from("calendar_appointments")
          .select("id, owner_user_id, starts_at, ends_at, status")
          .eq("organization_id", organizationId)
          .in("owner_user_id", userIds)
          .lt("starts_at", ateISO)
          .gt("ends_at", deISO)
      : vazio,
    // A situação das conexões, para distinguir "não tem Google" de "tem Google
    // que nunca foi lido" — e o id, que é por onde os eventos externos chegam
    // (`calendar_external_events` NÃO tem `user_id`).
    comLogin
      ? supabase
          .from("calendar_connections")
          .select("id, user_id, status, last_sync_at")
          .eq("organization_id", organizationId)
          .in("user_id", userIds)
      : vazio,
  ]);

  const erro = disp.error ?? excs.error ?? parts.error ?? doDono.error ?? conexoes.error;
  if (erro) return { ok: false, motivoParaOperador: erro.message };

  const linhasDeConexao = (conexoes.data ?? []) as {
    id: string;
    user_id: string;
    status: string;
    last_sync_at: string | null;
  }[];

  let externosRaw: {
    connection_id: string;
    starts_at: string;
    ends_at: string;
    transparency: string;
    status: string;
  }[] = [];
  if (linhasDeConexao.length > 0) {
    const { data, error } = await supabase
      .from("calendar_external_events")
      .select("connection_id, starts_at, ends_at, transparency, status")
      .eq("organization_id", organizationId)
      .in(
        "connection_id",
        linhasDeConexao.map((c) => String(c.id)),
      )
      .lt("starts_at", ateISO)
      .gt("ends_at", deISO);
    if (error) return { ok: false, motivoParaOperador: error.message };
    externosRaw = (data ?? []) as typeof externosRaw;
  }

  // ─── separação por pessoa, em memória ───────────────────────────────────
  const schedulePorUsuario = new Map<string, unknown>();
  for (const l of (disp.data ?? []) as { user_id: string; schedule: unknown }[]) {
    schedulePorUsuario.set(String(l.user_id), l.schedule);
  }

  const conexaoPorId = new Map(linhasDeConexao.map((c) => [String(c.id), c]));

  const agendas = new Map<string, AgendaDoProfissional>();
  for (const p of profissionais) {
    const id = String(p.id);
    const userId = p.user_id ? String(p.user_id) : null;

    const excecoes: ExcecaoDeData[] = (
      (excs.data ?? []) as {
        professional_id: string;
        exception_date: string;
        is_unavailable: boolean;
        start_minute: number;
        end_minute: number;
      }[]
    )
      .filter((l) => String(l.professional_id) === id)
      .map((l) => ({
        // ⚠️ `exception_date` é `date` no Postgres e chega como "YYYY-MM-DD" pelo
        // PostgREST. `diaLocalISO` compara STRING — um `Date` aqui não casaria com
        // dia nenhum, e o bloqueio sumiria em silêncio.
        data: String(l.exception_date).slice(0, 10),
        indisponivel: l.is_unavailable,
        inicioMinuto: l.start_minute,
        fimMinuto: l.end_minute,
      }));

    const participacoes: LinhaDeAgendamento[] = (
      (parts.data ?? []) as {
        appointment_id: string;
        professional_id: string;
        starts_at: string;
        ends_at: string;
        status: string;
      }[]
    )
      .filter((l) => String(l.professional_id) === id)
      .map((l) => ({
        id: String(l.appointment_id),
        starts_at: l.starts_at,
        ends_at: l.ends_at,
        status: l.status,
      }));

    const agendamentosDoDono: LinhaDeAgendamento[] = userId
      ? (
          (doDono.data ?? []) as {
            id: string;
            owner_user_id: string;
            starts_at: string;
            ends_at: string;
            status: string;
          }[]
        )
          .filter((l) => String(l.owner_user_id) === userId)
          .map((l) => ({
            id: String(l.id),
            starts_at: l.starts_at,
            ends_at: l.ends_at,
            status: l.status,
          }))
      : [];

    const conexoesDela = userId ? linhasDeConexao.filter((c) => String(c.user_id) === userId) : [];
    const externos: LinhaDeEventoExterno[] = userId
      ? externosRaw
          .filter((e) => conexaoPorId.get(String(e.connection_id))?.user_id === userId)
          .map((e) => ({
            starts_at: e.starts_at,
            ends_at: e.ends_at,
            transparency: e.transparency,
            status: e.status,
            // Conexão ilegível cai no mesmo lado de "não sei", que é o seguro.
            situacaoDaConexao: conexaoPorId.get(String(e.connection_id))?.status ?? "error",
          }))
      : [];

    const { ocupados, fontesDefasadas } = ocupadosDoProfissional(
      { participacoes, agendamentosDoDono, externos },
      opcoes.ignorarAgendamentoId,
    );

    agendas.set(id, {
      profissional: resumoDe(p),
      posicao: Number(p.position),
      leitura: jornadaDoProfissional(
        { user_id: userId, schedule: p.schedule },
        userId ? schedulePorUsuario.get(userId) : undefined,
      ),
      excecoes,
      ocupados,
      fontesDefasadas,
      agendaExternaNuncaLida: agendaExternaNuncaLida(conexoesDela),
    });
  }

  return { ok: true, agendas };
}

/**
 * As profissionais ATIVAS habilitadas no tipo, na ordem de exibição.
 *
 * Vazio quer dizer "o tipo não tem habilitação ativa" — quem chama cai para o
 * dono padrão do tipo (a regra de `horariosLivresDaOrg`), em vez de concluir
 * que ninguém atende.
 */
export async function profissionaisHabilitados(
  supabase: SupabaseClient,
  organizationId: string,
  eventTypeId: string,
): Promise<ProfissionalResumo[]> {
  const { data: hab, error: erroHab } = await supabase
    .from("calendar_event_type_professionals")
    .select("professional_id")
    .eq("organization_id", organizationId)
    .eq("event_type_id", eventTypeId);
  if (erroHab) throw new Error(erroHab.message);

  const ids = [...new Set((hab ?? []).map((l) => String(l.professional_id)))];
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from("calendar_professionals")
    .select(COLUNAS_DO_PROFISSIONAL)
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .in("id", ids);
  if (error) throw new Error(error.message);

  return ((data ?? []) as LinhaDeProfissional[]).sort(ordemDeExibicao).map(resumoDe);
}

/** O membro não é (ou deixou de ser) desta organização. */
export class MembroForaDaOrganizacaoError extends Error {
  constructor(readonly userId: string) {
    super(`O usuário ${userId} não é membro ativo desta organização.`);
    this.name = "MembroForaDaOrganizacaoError";
  }
}

/**
 * O id do profissional do membro `userId`, criando-o se ainda não existe.
 *
 * ─── Idempotente pelo índice `(organization_id, user_id)` ──────────────────
 *
 * Não é `.upsert(..., { onConflict })`: `calendar_professionals_membro_key` é
 * índice PARCIAL (`where user_id is not null`), e o `on_conflict` do PostgREST
 * não carrega o predicado — o Postgres não infere índice parcial sem ele e
 * responde 42P10. Então: lê; se não há, insere; se o insert perde a corrida
 * para outra requisição (23505 no mesmo índice), lê de novo e devolve a linha
 * que a outra criou. Duas chamadas simultâneas terminam com o MESMO id.
 *
 * ─── Só membro ATIVO da organização ────────────────────────────────────────
 *
 * `user_id` vem de fora (`owner_user_id` legado no corpo, dono padrão do tipo).
 * Criar profissional para quem não é membro daria agenda nesta organização a um
 * usuário de outra — por isso a conferência em `user_organizations`, e
 * `MembroForaDaOrganizacaoError` quando não passa.
 *
 * O nome vem do GoTrue (`user_metadata.full_name`, a mesma fonte do backfill da
 * 0245), e só o client ADMIN alcança `auth.admin`. Com client de sessão, ou com o
 * GoTrue fora, cai para "Profissional": nome é enfeite renomeável na tela,
 * e não pode derrubar uma marcação.
 */
export async function garantirProfissionalDoMembro(
  supabase: SupabaseClient,
  organizationId: string,
  userId: string,
): Promise<string> {
  const existente = await profissionalDoMembro(supabase, organizationId, userId);
  if (existente) return existente;

  const { data: membro, error: erroMembro } = await supabase
    .from("user_organizations")
    .select("calendar_trilha, revoked_at")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (erroMembro) throw new Error(erroMembro.message);
  if (!membro || membro.revoked_at !== null) throw new MembroForaDaOrganizacaoError(userId);

  const { error: erroInsert } = await supabase.from("calendar_professionals").insert({
    organization_id: organizationId,
    user_id: userId,
    name: await nomeDoMembro(supabase, userId),
    trilha: trilhaDe(membro.calendar_trilha),
  });

  if (erroInsert && erroInsert.code !== "23505") throw new Error(erroInsert.message);

  const criado = await profissionalDoMembro(supabase, organizationId, userId);
  if (!criado) {
    throw new Error("O profissional do membro foi criado e não pôde ser lido de volta.");
  }
  return criado;
}

async function profissionalDoMembro(
  supabase: SupabaseClient,
  organizationId: string,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("calendar_professionals")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? String(data.id) : null;
}

/** Mesma expressão do backfill da 0245: full_name, parte local do e-mail, "Profissional". */
async function nomeDoMembro(supabase: SupabaseClient, userId: string): Promise<string> {
  try {
    const { data } = await supabase.auth.admin.getUserById(userId);
    const usuario = data?.user;
    const meta = usuario?.user_metadata as { full_name?: unknown } | undefined;
    const completo = typeof meta?.full_name === "string" ? meta.full_name.trim() : "";
    const local = (usuario?.email ?? "").split("@")[0]?.trim() ?? "";
    return (completo || local || "Profissional").slice(0, 120);
  } catch {
    return "Profissional";
  }
}
