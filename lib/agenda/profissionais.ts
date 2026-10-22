/**
 * OS PROFISSIONAIS DA AGENDA — a coleta por pessoa (migration 0245).
 *
 * ⚠️ STUB DE COMPILAÇÃO (Fase 0). As assinaturas abaixo são o contrato que as
 * frentes paralelas consomem; a FRENTE A implementa os corpos. Até lá, toda
 * função lança — nada aqui é chamado em produção ainda.
 *
 * Quando implementar: o client pode ser o ADMIN (service role, bypassa a RLS),
 * então TODA query filtra `organization_id` explicitamente — mesma regra de
 * `lib/agenda/consulta.ts` (anti-pattern nº 10 do CLAUDE.md).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { ProfissionalResumo } from "./contrato";
import type { ExcecaoDeData, Ocupado } from "./horarios-livres";
import type { LeituraDaJornada } from "./jornada";
import type { SituacaoDaConexao } from "./tipos";

const NAO_IMPLEMENTADO = "frente A implementa";

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
  leitura: LeituraDaJornada;
  excecoes: ExcecaoDeData[];
  ocupados: Ocupado[];
  fontesDefasadas: SituacaoDaConexao[];
  agendaExternaNuncaLida: boolean;
}

export type ResultadoDaColetaDosProfissionais =
  | { ok: true; agendas: Map<string, AgendaDoProfissional> }
  | { ok: false; motivoParaOperador: string };

/**
 * A jornada de uma profissional, PURA.
 *
 * Com login: lê `scheduleDoMembro` (`attendant_availability.schedule`).
 * Sem login: lê `p.schedule`. Os dois pelo MESMO `lerJornadaDoBanco`.
 */
export function jornadaDoProfissional(
  _p: ProfissionalComJornada,
  _scheduleDoMembro: unknown,
): LeituraDaJornada {
  throw new Error(NAO_IMPLEMENTADO);
}

/**
 * Coleta, em lote (`.in()`), tudo o que o motor precisa das profissionais
 * `ids`: disponibilidade, exceções por `professional_id`, participações,
 * agendamentos por `owner_user_id` (legado/Google), eventos externos e conexões.
 */
export async function carregarAgendasDosProfissionais(
  _supabase: SupabaseClient,
  _organizationId: string,
  _ids: string[],
  _opcoes: { de: Date; ate: Date; ignorarAgendamentoId?: string | null },
): Promise<ResultadoDaColetaDosProfissionais> {
  throw new Error(NAO_IMPLEMENTADO);
}

/** As profissionais ATIVAS habilitadas no tipo (vazio = o tipo não tem habilitação). */
export async function profissionaisHabilitados(
  _supabase: SupabaseClient,
  _organizationId: string,
  _eventTypeId: string,
): Promise<ProfissionalResumo[]> {
  throw new Error(NAO_IMPLEMENTADO);
}

/** O id do profissional do membro `userId`, criando-o se ainda não existe. */
export async function garantirProfissionalDoMembro(
  _supabase: SupabaseClient,
  _organizationId: string,
  _userId: string,
): Promise<string> {
  throw new Error(NAO_IMPLEMENTADO);
}
