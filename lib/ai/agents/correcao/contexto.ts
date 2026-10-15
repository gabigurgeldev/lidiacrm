/**
 * Corrigir agente com IA — o que o servidor lê para diagnosticar e propor.
 *
 * Tudo com o client admin, e por isso TODA consulta filtra `organization_id`
 * pela organização da sessão (anti-pattern 10). O agente vem do caminho e a
 * conversa do corpo: os dois são conferidos contra a organização — conversa de
 * outra organização é "não encontrada", nunca lida.
 *
 * A conversa vai ao modelo com CPF, e-mail, telefone e CEP mascarados
 * (`lib/ai/anonymize`): o modelo precisa do que aconteceu, não de quem era.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { anonymize } from "@/lib/ai/anonymize";
import { COLUNAS_DO_CONTEUDO } from "@/lib/ai/agents/conteudo-da-versao";
import { versionCreateSchema, type VersionInput } from "@/lib/ai/agents/validation";
import { escolherVersoesDaTela } from "@/lib/ai/agents/versoes-da-tela";

import { MAX_EXECUCOES_LIDAS, MAX_MENSAGENS_DA_CONVERSA } from "./esquemas";

const COLUNAS_DA_VERSAO = ["id", "version_number", "status", ...COLUNAS_DO_CONTEUDO].join(", ");
const AMOSTRA_POR_MATERIAL = 1_200;
const TETO_DE_MATERIAIS_LIDOS = 12;

export interface VersaoBase {
  id: string;
  version_number: number;
  status: string;
  /** O conteúdo, na forma que `versionCreateSchema` aceita; null se a linha não passa no schema. */
  conteudo: VersionInput | null;
  /** A linha crua — é o que se copia quando o schema recusa (dado legado). */
  bruta: Record<string, unknown>;
}

export interface ContextoDaCorrecao {
  agente: { id: string; nome: string; descricao: string | null };
  base: VersaoBase;
  /** Há rascunho vigente: a correção parte DELE, e a tela avisa. */
  partiuDoRascunho: boolean;
  materiais: Array<{ id: string; nome: string; tipo: string; amostra: string }>;
  execucoes: Array<{
    quando: string;
    status: string;
    motivo: string | null;
    erro: string | null;
    ferramentas: string[];
  }>;
  conversa: Array<{ de: "cliente" | "agente" | "equipe"; texto: string; quando: string }> | null;
}

export type ResultadoDoContexto =
  | { ok: true; contexto: ContextoDaCorrecao }
  | { ok: false; status: 404 | 409 | 422; code: string; message: string };

type Linha = Record<string, unknown>;

function nomesDasFerramentas(toolCalls: unknown): string[] {
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls
    .map((c) => (c && typeof c === "object" ? ((c as Linha).name ?? (c as Linha).tool ?? (c as Linha).toolName) : null))
    .filter((n): n is string => typeof n === "string")
    .slice(0, 12);
}

/** Colunas que aceitam null no schema; nas outras, null = "use o padrão". */
const NULO_VALE = new Set<string>(["credential_id", "operator_model", "skill_names"]);

/**
 * Da linha de `ai_agent_versions`, só o CONTEÚDO, na forma de
 * `versionCreateSchema` — que é estrito: `id`, `status` e companhia o fariam
 * recusar a linha inteira.
 */
export function conteudoDaLinha(linha: Linha): Linha {
  const saida: Linha = {};
  for (const coluna of COLUNAS_DO_CONTEUDO) {
    const valor = linha[coluna];
    if (valor === undefined || (valor === null && !NULO_VALE.has(coluna))) continue;
    saida[coluna] = valor;
  }
  return saida;
}

/** Uma mensagem como o modelo a vê: quem falou e o texto mascarado. */
export function falaMascarada(m: { body: string | null; direction: string; sent_via: string | null; type: string }): string {
  const texto = m.body?.trim() ? m.body : `[${m.type}]`;
  return anonymize(texto.slice(0, 2_000)).anonymized;
}

export async function carregarContextoDaCorrecao(
  admin: SupabaseClient,
  orgId: string,
  agentId: string,
  opcoes: { conversationId?: string } = {},
): Promise<ResultadoDoContexto> {
  const { data: agente } = await admin
    .from("ai_agents")
    .select("id, name, description, kind, archived_at, published_version_id")
    .eq("id", agentId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!agente) return { ok: false, status: 404, code: "not_found", message: "Agente não encontrado." };
  const a = agente as Linha;
  if (a.archived_at) return { ok: false, status: 409, code: "agent_archived", message: "Este agente está arquivado." };
  if (a.kind !== "mcp_agent") {
    return {
      ok: false,
      status: 422,
      code: "validation_failed",
      message: "Só agentes do editor atual podem ser corrigidos com IA. Abra este no editor.",
    };
  }

  const { data: versoes } = await admin
    .from("ai_agent_versions")
    .select(COLUNAS_DA_VERSAO)
    .eq("organization_id", orgId)
    .eq("agent_id", agentId)
    .order("version_number", { ascending: false })
    .limit(30);
  const linhas = ((versoes ?? []) as unknown as Array<Linha & { id: string; version_number: number; status: string }>);
  const escolha = escolherVersoesDaTela(linhas, (a.published_version_id as string | null) ?? null);
  const base = escolha.draft ?? escolha.published ?? escolha.base;
  if (!base) return { ok: false, status: 422, code: "validation_failed", message: "Este agente ainda não tem versão." };

  const lida = versionCreateSchema.safeParse(conteudoDaLinha(base));
  const conteudo = lida.success ? lida.data : null;

  // ── Materiais ligados à base, com uma amostra do começo de cada um ─────────
  const idsDoAcervo = ((base.knowledge_source_ids as string[] | null) ?? []).slice(0, TETO_DE_MATERIAIS_LIDOS);
  let materiais: ContextoDaCorrecao["materiais"] = [];
  if (idsDoAcervo.length > 0) {
    const [{ data: fontes }, { data: trechos }] = await Promise.all([
      admin.from("ai_knowledge_sources").select("id, name, source_type").eq("organization_id", orgId).in("id", idsDoAcervo),
      admin
        .from("ai_chunks")
        .select("knowledge_source_id, position, content")
        .eq("organization_id", orgId)
        .in("knowledge_source_id", idsDoAcervo)
        .lt("position", 2)
        .order("position", { ascending: true })
        .limit(TETO_DE_MATERIAIS_LIDOS * 4),
    ]);
    const amostras = new Map<string, string>();
    for (const t of (trechos ?? []) as Linha[]) {
      const id = t.knowledge_source_id as string;
      const atual = amostras.get(id) ?? "";
      if (atual.length >= AMOSTRA_POR_MATERIAL) continue;
      amostras.set(id, `${atual}${atual ? "\n" : ""}${String(t.content)}`.slice(0, AMOSTRA_POR_MATERIAL));
    }
    materiais = ((fontes ?? []) as Linha[]).map((f) => ({
      id: f.id as string,
      nome: (f.name as string) || "(sem nome)",
      tipo: f.source_type as string,
      amostra: amostras.get(f.id as string) ?? "",
    }));
  }

  // ── Últimas execuções: o que deu errado, e com que ferramenta ──────────────
  const { data: runs } = await admin
    .from("ai_agent_runs")
    .select("status, abort_reason, error_code, error_message, tool_calls, created_at")
    .eq("organization_id", orgId)
    .eq("agent_id", agentId)
    .eq("is_dry_run", false)
    .order("created_at", { ascending: false })
    .limit(MAX_EXECUCOES_LIDAS);
  const execucoes = ((runs ?? []) as Linha[]).map((r) => ({
    quando: String(r.created_at),
    status: String(r.status),
    motivo: (r.abort_reason as string | null) ?? null,
    erro: r.error_code ? `${String(r.error_code)}: ${String(r.error_message ?? "").slice(0, 200)}` : null,
    ferramentas: nomesDasFerramentas(r.tool_calls),
  }));

  // ── A conversa que a pessoa apontou ────────────────────────────────────────
  let conversa: ContextoDaCorrecao["conversa"] = null;
  if (opcoes.conversationId) {
    const { data: conv } = await admin
      .from("conversations")
      .select("id")
      .eq("id", opcoes.conversationId)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (!conv) return { ok: false, status: 404, code: "not_found", message: "Conversa não encontrada." };
    const { data: msgs } = await admin
      .from("messages")
      .select("body, direction, sent_via, type, sent_at")
      .eq("organization_id", orgId)
      .eq("conversation_id", opcoes.conversationId)
      .order("sent_at", { ascending: false })
      .limit(MAX_MENSAGENS_DA_CONVERSA);
    conversa = ((msgs ?? []) as Array<{ body: string | null; direction: string; sent_via: string | null; type: string; sent_at: string }>)
      .reverse()
      .filter((m) => m.type !== "reaction" && m.type !== "system")
      .map((m) => ({
        de: m.direction === "inbound" ? ("cliente" as const) : m.sent_via === "ai" ? ("agente" as const) : ("equipe" as const),
        texto: falaMascarada(m),
        quando: m.sent_at,
      }));
  }

  return {
    ok: true,
    contexto: {
      agente: { id: a.id as string, nome: a.name as string, descricao: (a.description as string | null) ?? null },
      base: { id: base.id, version_number: base.version_number, status: base.status, conteudo, bruta: base },
      partiuDoRascunho: base.status === "draft",
      materiais,
      execucoes,
      conversa,
    },
  };
}
