/**
 * O estado de coordenação de uma conversa, e a única porta que o muda.
 *
 * Leitura aqui; mudança de responsável SÓ por `transicionar` — que chama
 * `fn_coord_transicionar`, onde moram o CAS, a prioridade humana, o diário e o
 * outbox. Nenhum outro código faz `update coord_estado_conversa`.
 *
 * `versao` e `geracao` são `bigint` no banco e o `pg` os devolve como string;
 * a conversão acontece UMA vez, em `numero()`.
 */
import type { Consulta } from "./banco";

export type DonoTipo = "nenhum" | "agente" | "fluxo" | "pessoa";
export type Situacao =
  | "ativo"
  | "esperando_cliente"
  | "esperando_tarefa"
  | "pausado"
  | "concluido"
  | "bloqueado";

export type CategoriaDeTransicao =
  | "regra"
  | "continuidade"
  | "modelo"
  | "manual"
  | "retorno"
  | "recuperacao"
  | "fallback"
  /** Um executor pediu a troca (o agente chamou ou transferiu). Migration 0230. */
  | "delegacao";

export interface EstadoDaConversa {
  organization_id: string;
  conversation_id: string;
  contact_id: string | null;
  channel_session_id: string | null;
  politica_versao_id: string | null;
  dono_tipo: DonoTipo;
  dono_agent_id: string | null;
  dono_agent_version_id: string | null;
  dono_execution_id: string | null;
  dono_frame_id: string | null;
  situacao: Situacao;
  versao: number;
  geracao: number;
  pergunta_id: string | null;
  pergunta_aberta_em: string | null;
  pergunta_formato: string | null;
  pergunta_frame_id: string | null;
  ultima_admitida_message_id: string | null;
  motivo: string | null;
  updated_at: string;
}

function numero(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** O estado "antes de existir": versão 0, ninguém conduzindo. */
export function estadoVazio(organizationId: string, conversationId: string): EstadoDaConversa {
  return {
    organization_id: organizationId,
    conversation_id: conversationId,
    contact_id: null,
    channel_session_id: null,
    politica_versao_id: null,
    dono_tipo: "nenhum",
    dono_agent_id: null,
    dono_agent_version_id: null,
    dono_execution_id: null,
    dono_frame_id: null,
    situacao: "ativo",
    versao: 0,
    geracao: 0,
    pergunta_id: null,
    pergunta_aberta_em: null,
    pergunta_formato: null,
    pergunta_frame_id: null,
    ultima_admitida_message_id: null,
    motivo: null,
    updated_at: new Date(0).toISOString(),
  };
}

/** `null` = o coordenador nunca tocou esta conversa. */
export async function lerEstado(
  db: Consulta,
  organizationId: string,
  conversationId: string,
): Promise<EstadoDaConversa | null> {
  const { rows } = await db.query<EstadoDaConversa>(
    `select organization_id, conversation_id, contact_id, channel_session_id, politica_versao_id,
            dono_tipo, dono_agent_id, dono_agent_version_id, dono_execution_id, dono_frame_id,
            situacao, versao, geracao, pergunta_id, pergunta_aberta_em, pergunta_formato,
            pergunta_frame_id, ultima_admitida_message_id, motivo, updated_at
       from public.coord_estado_conversa
      where organization_id = $1 and conversation_id = $2`,
    [organizationId, conversationId],
  );
  const r = rows[0];
  if (!r) return null;
  return { ...r, versao: numero(r.versao), geracao: numero(r.geracao) };
}

export interface PedidoDeTransicao {
  organizationId: string;
  conversationId: string;
  /** A versão LIDA antes de decidir. Divergiu = alguém transicionou no meio. */
  versaoEsperada: number;
  para:
    | { tipo: "nenhum" }
    | { tipo: "pessoa" }
    | { tipo: "agente"; agentId: string; agentVersionId: string | null }
    | { tipo: "fluxo"; executionId: string; frameId: string | null };
  situacao?: Situacao;
  categoria: CategoriaDeTransicao;
  motivo: string;
  politicaVersaoId?: string | null;
  messageId?: string | null;
  chamadaId?: string | null;
  /** Evento a nascer no outbox, na mesma transação da troca. */
  despacho?: {
    event_type: string;
    entity_kind?: string;
    entity_id?: string | null;
    payload: Record<string, unknown>;
  } | null;
  detalhe?: Record<string, unknown>;
}

export type ResultadoDaTransicao =
  | { ok: true; versao: number; geracao: number; eventoId: string | null }
  | {
      ok: false;
      motivo: "conflito" | "prioridade_humana" | "destino_invalido" | "conversa_inexistente";
      versao?: number;
      geracao?: number;
    };

export async function transicionar(db: Consulta, p: PedidoDeTransicao): Promise<ResultadoDaTransicao> {
  const para = p.para;
  const { rows } = await db.query<{ r: Record<string, unknown> }>(
    `select public.fn_coord_transicionar(
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16::jsonb
     ) as r`,
    [
      p.organizationId,
      p.conversationId,
      p.versaoEsperada,
      para.tipo,
      para.tipo === "agente" ? para.agentId : null,
      para.tipo === "agente" ? para.agentVersionId : null,
      para.tipo === "fluxo" ? para.executionId : null,
      para.tipo === "fluxo" ? para.frameId : null,
      p.situacao ?? null,
      p.categoria,
      p.motivo,
      p.politicaVersaoId ?? null,
      p.messageId ?? null,
      p.chamadaId ?? null,
      p.despacho ? JSON.stringify(p.despacho) : null,
      JSON.stringify(p.detalhe ?? {}),
    ],
  );
  const r = rows[0]?.r ?? {};
  if (r.ok === true) {
    return {
      ok: true,
      versao: numero(r.versao),
      geracao: numero(r.geracao),
      eventoId: typeof r.evento_id === "string" ? r.evento_id : null,
    };
  }
  return {
    ok: false,
    motivo: (r.motivo as Extract<ResultadoDaTransicao, { ok: false }>["motivo"]) ?? "conflito",
    versao: r.versao === undefined ? undefined : numero(r.versao),
    geracao: r.geracao === undefined ? undefined : numero(r.geracao),
  };
}

export type ConsumidorTipo = "agente" | "fluxo" | "followup" | "nenhum";

export interface Admissao {
  jaAdmitida: boolean;
  consumidorTipo: ConsumidorTipo;
  consumidorId: string | null;
  perguntaId: string | null;
  geracao: number;
}

/** Idempotente: a segunda chamada para a mesma mensagem devolve a primeira. */
export async function admitir(
  db: Consulta,
  a: {
    organizationId: string;
    messageId: string;
    conversationId: string;
    consumidorTipo: ConsumidorTipo;
    consumidorId: string | null;
    perguntaId: string | null;
    geracao: number;
  },
): Promise<Admissao> {
  const { rows } = await db.query<{ r: Record<string, unknown> }>(
    `select public.fn_coord_admitir($1, $2, $3, $4, $5, $6, $7) as r`,
    [a.organizationId, a.messageId, a.conversationId, a.consumidorTipo, a.consumidorId, a.perguntaId, a.geracao],
  );
  const r = rows[0]?.r ?? {};
  return {
    jaAdmitida: r.ja_admitida === true,
    consumidorTipo: (r.consumidor_tipo as ConsumidorTipo) ?? a.consumidorTipo,
    consumidorId: (r.consumidor_id as string | null) ?? null,
    perguntaId: (r.pergunta_id as string | null) ?? null,
    geracao: numero(r.geracao),
  };
}

export type MotivoDaFala =
  | "sem_coordenacao"
  | "dono_atual"
  | "bloqueado"
  | "pessoa_no_comando"
  | "sem_dono"
  | "geracao_obsoleta"
  | "nao_e_o_dono";

/**
 * O executor pode falar com o cliente AGORA?
 *
 * É a checagem que fica colada ao envio (fencing). Sem linha de estado, o
 * coordenador não conduz a conversa e o caminho legado decide — `pode: true`.
 */
export async function podeFalar(
  db: Consulta,
  q: {
    organizationId: string;
    conversationId: string;
    executorTipo: "agente" | "fluxo";
    executorId: string;
    geracao: number | null;
  },
): Promise<{ pode: boolean; motivo: MotivoDaFala; geracao: number | null }> {
  const { rows } = await db.query<{ r: Record<string, unknown> }>(
    `select public.fn_coord_pode_falar($1, $2, $3, $4, $5) as r`,
    [q.organizationId, q.conversationId, q.executorTipo, q.executorId, q.geracao],
  );
  const r = rows[0]?.r ?? {};
  return {
    pode: r.pode === true,
    motivo: (r.motivo as MotivoDaFala) ?? "sem_dono",
    geracao: r.geracao === undefined ? null : numero(r.geracao),
  };
}
