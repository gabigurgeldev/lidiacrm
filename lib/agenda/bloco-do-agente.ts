/**
 * O BLOCO DA AGENDA no prompt do agente — o que dá para marcar, em texto.
 *
 * ─── Por que existe ──────────────────────────────────────────────────────────
 *
 * As ferramentas de agenda falam SLUG (`crm_find_free_slots.event_type_slug`),
 * e o modelo não tinha de onde tirá-lo: ou adivinhava (`consulta`, `consulta-1`,
 * `avaliacao`...) e colecionava recusas, ou perguntava ao cliente "qual o
 * identificador do atendimento?". Este bloco entrega a lista no turno.
 *
 * ─── O que NÃO entra, e por quê ──────────────────────────────────────────────
 *
 * - UUID nenhum. Id no prompt é o que o modelo copia para o lugar errado — e o
 *   cliente nunca precisa dele. As profissionais vão por NOME; a ferramenta
 *   resolve o nome entre as habilitadas.
 * - O bloco só existe quando o turno TEM ferramenta de agenda (`turnoTemAgenda`).
 *   Agente sem agenda não ganha uma linha, e o texto mora no SUFIXO do turno —
 *   o prefixo cacheável não muda para ninguém.
 *
 * ⚠️ O client pode ser o ADMIN (service role): toda query filtra
 * `organization_id` explicitamente (anti-pattern nº 10 do CLAUDE.md).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

/** Um tipo de atendimento que o agente pode marcar, já em palavras. */
export interface TipoAgendavel {
  slug: string;
  nome: string;
  duracaoMinutos: number;
  profissionaisNecessarios: 1 | 2;
  /** Nomes das profissionais ATIVAS habilitadas no tipo, na ordem de exibição. */
  profissionais: string[];
}

/** Quantos nomes cabem numa linha antes de virar "e mais N". */
const MAXIMO_DE_NOMES = 8;

/** O turno tem ferramenta de agenda? É o que decide se o bloco entra. */
export function turnoTemAgenda(toolIds: readonly string[]): boolean {
  return toolIds.some((id) => id === "crm_find_free_slots" || /^crm_\w*appointment/.test(id));
}

/** Texto de banco entrando em prompt: uma linha, sem crase (que delimita o slug). */
function limpo(texto: string): string {
  return texto.replace(/[`\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

function listaDeNomes(nomes: string[], conector: "ou" | "e"): string {
  const visiveis = nomes.slice(0, MAXIMO_DE_NOMES);
  const resto = nomes.length - visiveis.length;
  if (resto > 0) return `${visiveis.join(", ")} e mais ${resto}`;
  if (visiveis.length <= 1) return visiveis.join("");
  return `${visiveis.slice(0, -1).join(", ")} ${conector} ${visiveis[visiveis.length - 1]}`;
}

function linhaDoTipo(t: TipoAgendavel): string {
  const quem =
    t.profissionaisNecessarios === 2
      ? t.profissionais.length > 0
        ? `precisa de 2 profissionais ao mesmo tempo, entre ${listaDeNomes(t.profissionais, "e")}`
        : "precisa de 2 profissionais ao mesmo tempo"
      : t.profissionais.length > 0
        ? `1 profissional: ${listaDeNomes(t.profissionais, "ou")}`
        : "1 profissional";
  return `- \`${t.slug}\` — ${limpo(t.nome)} (${t.duracaoMinutos} min; ${quem})`;
}

/** O bloco, PURO — o que vai ao prompt a partir dos tipos já carregados. */
export function montarBlocoDaAgenda(tipos: TipoAgendavel[]): string {
  if (tipos.length === 0) {
    return (
      "## Agenda\n" +
      "Nenhum atendimento está aberto para marcação agora. Não ofereça horários e não diga " +
      "que a agenda está cheia: avise que alguém da equipe confirma o horário."
    );
  }
  return [
    "## Agenda",
    "Atendimentos que você pode marcar — nas ferramentas de agenda, use o identificador entre crases:",
    ...tipos.map(linhaDoTipo),
    "Quem é atendido é sempre a pessoa desta conversa: ao marcar, o cliente é preenchido sozinho — " +
      "não pergunte nem informe identificador de cliente. Se a pessoa pedir uma profissional pelo nome, " +
      "informe o nome em `profissional` ao consultar os horários livres.",
  ].join("\n");
}

/**
 * Os tipos ATIVOS da organização, com as profissionais habilitadas. `null` =
 * erro de leitura (quem chama decide; o bloco vira vazio).
 */
export async function tiposAgendaveis(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<TipoAgendavel[] | null> {
  const { data: tipos, error } = await supabase
    .from("calendar_event_types")
    .select("id, slug, name, duration_minutes, professionals_required, position")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("position", { ascending: true })
    .order("name", { ascending: true });
  if (error) {
    logger.warn("agenda: não consegui ler os tipos para o bloco do agente", { erro: error.message });
    return null;
  }
  const linhas = (tipos ?? []) as {
    id: string;
    slug: string;
    name: string;
    duration_minutes: number;
    professionals_required: number | null;
  }[];
  if (linhas.length === 0) return [];

  const { data: habilitacoes, error: errHab } = await supabase
    .from("calendar_event_type_professionals")
    .select("event_type_id, professional_id")
    .eq("organization_id", organizationId)
    .in(
      "event_type_id",
      linhas.map((t) => t.id),
    );
  const { data: pessoas, error: errPes } = await supabase
    .from("calendar_professionals")
    .select("id, name, position")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("position", { ascending: true })
    .order("name", { ascending: true });
  // Sem as profissionais o bloco ainda serve: os slugs são o que o modelo
  // precisa para chamar a ferramenta. Os nomes são conforto, não requisito.
  if (errHab || errPes) {
    logger.warn("agenda: não consegui ler as profissionais para o bloco do agente", {
      erro: (errHab ?? errPes)?.message,
    });
  }
  const ordem = errPes ? [] : ((pessoas ?? []) as { id: string; name: string }[]);
  const habilitadasPorTipo = new Map<string, Set<string>>();
  for (const h of (errHab ? [] : (habilitacoes ?? [])) as { event_type_id: string; professional_id: string }[]) {
    const conjunto = habilitadasPorTipo.get(h.event_type_id) ?? new Set<string>();
    conjunto.add(h.professional_id);
    habilitadasPorTipo.set(h.event_type_id, conjunto);
  }

  return linhas.map((t) => {
    const habilitadas = habilitadasPorTipo.get(t.id);
    return {
      slug: t.slug,
      nome: t.name,
      duracaoMinutos: t.duration_minutes,
      profissionaisNecessarios: t.professionals_required === 2 ? 2 : 1,
      profissionais: habilitadas
        ? ordem.filter((p) => habilitadas.has(p.id)).map((p) => limpo(p.name))
        : [],
    };
  });
}

/** O bloco pronto para o sufixo do turno. NUNCA lança: falha vira `""`. */
export async function blocoDaAgenda(supabase: SupabaseClient, organizationId: string): Promise<string> {
  try {
    const tipos = await tiposAgendaveis(supabase, organizationId);
    return tipos === null ? "" : montarBlocoDaAgenda(tipos);
  } catch (err) {
    logger.warn("agenda: bloco do agente não montado", {
      erro: err instanceof Error ? err.message : String(err),
    });
    return "";
  }
}

/**
 * Só os slugs dos tipos ATIVOS — para a recusa `tipo_desconhecido` ensinar o
 * que existe em vez de só negar. NUNCA lança: falha vira lista vazia, e a
 * recusa segue sem a lista.
 */
export async function slugsDosTiposAtivos(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from("calendar_event_types")
      .select("slug")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("position", { ascending: true });
    if (error) return [];
    return ((data ?? []) as { slug: string }[]).map((t) => t.slug);
  } catch {
    return [];
  }
}
