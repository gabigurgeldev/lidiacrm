export interface Citation {
  chunk_id?: string;
  knowledge_source_id?: string | null;
  source_type?:
    | "faq"
    | "policy"
    | "conversation"
    | "conversations"
    | "catalog"
    | "nuvemshop_catalog"
    | string;
  source_anchor?: string | null;
  /** Nome do material, como a pessoa o vê no acervo ("Tabela de preços 2026"). */
  source_name?: string | null;
  /** Posição do trecho dentro do material, a partir de 1. Gravado no envio. */
  trecho?: number;
  score?: number; // 0..1 cosine similarity
  snippet?: string;
  text?: string; // fallback if snippet absent
  metadata?: Record<string, unknown>;
}

export function extractCitations(messageMetadata: unknown): Citation[] {
  if (!messageMetadata || typeof messageMetadata !== "object") return [];
  const m = messageMetadata as Record<string, unknown>;
  const raw = m.citations;
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is Citation => !!c && typeof c === "object");
}

/**
 * A mensagem do agente afirma fato da empresa sem nenhum trecho do material no
 * turno (gravado no envio pelo motor). Não quer dizer "inventou": a afirmação
 * pode ter vindo das instruções do agente ou de uma ferramenta — por isso a
 * tela diz "sem trecho do material", e só ao atendente.
 */
export function isSemFonteMessage(messageMetadata: unknown): boolean {
  if (!messageMetadata || typeof messageMetadata !== "object") return false;
  return (messageMetadata as Record<string, unknown>).sem_fonte === true;
}

export function isAiGeneratedMessage(messageMetadata: unknown): boolean {
  if (!messageMetadata || typeof messageMetadata !== "object") return false;
  return (messageMetadata as Record<string, unknown>).ai_generated === true;
}
