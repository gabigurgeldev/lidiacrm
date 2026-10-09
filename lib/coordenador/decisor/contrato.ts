/**
 * O contrato do decisor — independente de fornecedor.
 *
 * Hoje há um adaptador: o seam de LLM (`./llm.ts`), que resolve modelo e chave
 * pela finalidade `coordenador_decidir` — o usuário escolhe o modelo (via
 * OpenRouter) no painel de provedores. Um adaptador de API de decisão dedicada
 * entra implementando a mesma interface, sem tocar no coordenador (ADR 0002 §6).
 *
 * O que entra é o MÍNIMO para decidir: o lote admitido (curto), quem conduz,
 * a pergunta aberta e os candidatos já filtrados. Nunca a base de RAG, nunca a
 * conversa inteira. Mensagem do cliente é EVIDÊNCIA, nunca instrução — o
 * adaptador a coloca separada das instruções confiáveis.
 */

export interface CandidatoDoDecisor {
  chave: string;
  nome: string;
  quando_usar: string;
  exemplos: string[];
  nao_usar: string[];
}

export interface PedidoDeDecisao {
  organizationId: string;
  conversationId: string;
  contactId: string | null;
  jobId: string | null;
  /** Texto do cliente (lote admitido), já truncado pelo chamador. */
  mensagem: string;
  /** Últimas falas, curtas, para contexto (opcional). */
  contexto: string[];
  atual: CandidatoDoDecisor | null;
  candidatos: CandidatoDoDecisor[];
  timeoutMs: number;
}

export interface Decisao {
  status: "ok" | "falhou" | "recusou" | "timeout";
  /** chave de candidato, "manter", "esclarecer" — ou null quando não decidiu. */
  escolha: string | null;
  /** null quando o provedor não informa. Nunca inventado. */
  confianca: number | null;
  provedor: string | null;
  modelo: string | null;
  ms: number;
  /** null = custo DESCONHECIDO (não zero). */
  custoCents: number | null;
  erro?: string;
}

export interface Decisor {
  decidir(pedido: PedidoDeDecisao): Promise<Decisao>;
}

/** Limites do que vai ao modelo. */
export const TETO_DA_MENSAGEM = 1500;
export const TETO_DO_CONTEXTO = 6;
export const TETO_DA_FALA_DE_CONTEXTO = 300;
