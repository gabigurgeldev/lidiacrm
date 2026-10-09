/**
 * O coordenador visto de quem fala com o banco pelo cliente Supabase (rotas do
 * app, o motor de fluxos) em vez do `pg` do worker.
 *
 * As regras são as MESMAS — a transição é a mesma RPC, a precedência da
 * política é a mesma de `carregarPoliticaEfetiva` —, só o transporte muda.
 * Toda chamada aqui usa o cliente ADMIN: as funções do coordenador são só do
 * service_role, e a organização vem sempre de fonte confiável do chamador.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * O coordenador está ATIVO para este número? O ponteiro do número vence o da
 * organização. Falha de leitura = não ativo: o coordenador é aditivo, e seguir
 * como antes dele é o comportamento seguro para quem lê.
 */
export async function coordenadorAtivoNoCanal(
  admin: SupabaseClient,
  organizationId: string,
  channelSessionId: string | null,
): Promise<boolean> {
  try {
    const { data, error } = await admin
      .from("coord_politica_ponteiros")
      .select("channel_session_id, versao_id")
      .eq("organization_id", organizationId);
    if (error !== null || !Array.isArray(data) || data.length === 0) return false;
    const ponteiros = data as { channel_session_id: string | null; versao_id: string }[];
    const doCanal =
      channelSessionId !== null ? ponteiros.find((p) => p.channel_session_id === channelSessionId) : undefined;
    const efetivo = doCanal ?? ponteiros.find((p) => p.channel_session_id === null);
    if (efetivo === undefined) return false;
    const { data: versao } = await admin
      .from("coord_politica_versoes")
      .select("modo")
      .eq("organization_id", organizationId)
      .eq("id", efetivo.versao_id)
      .maybeSingle();
    return (versao as { modo?: string } | null)?.modo === "active";
  } catch {
    return false;
  }
}

/**
 * Entrega a conversa a uma execução de fluxo por AÇÃO DA EQUIPE (categoria
 * `manual`, a única que tira a conversa de uma pessoa). Uma nova tentativa em
 * conflito: entre ler a versão e transicionar, outra decisão pode ter passado.
 */
export async function entregarAoFluxoPelaEquipe(
  admin: SupabaseClient,
  p: { organizationId: string; conversationId: string; executionId: string; userId: string },
): Promise<{ ok: true; geracao: number } | { ok: false; motivo: string }> {
  for (let tentativa = 0; tentativa < 2; tentativa += 1) {
    const { data: estado } = await admin
      .from("coord_estado_conversa")
      .select("versao")
      .eq("organization_id", p.organizationId)
      .eq("conversation_id", p.conversationId)
      .maybeSingle();
    const versao = Number((estado as { versao?: string | number } | null)?.versao ?? 0);
    const { data, error } = await admin.rpc("fn_coord_transicionar" as never, {
      p_org: p.organizationId,
      p_conversa: p.conversationId,
      p_versao_esperada: versao,
      p_dono_tipo: "fluxo",
      p_dono_agent_id: null,
      p_dono_agent_version_id: null,
      p_dono_execution_id: p.executionId,
      p_dono_frame_id: null,
      p_situacao: "ativo",
      p_categoria: "manual",
      p_motivo: "ativacao_manual",
      p_politica_versao_id: null,
      p_message_id: null,
      p_chamada_id: null,
      p_despacho: null,
      p_detalhe: { user_id: p.userId },
    } as never);
    if (error) return { ok: false, motivo: error.message.slice(0, 120) };
    const r = (data ?? {}) as { ok?: boolean; motivo?: string; geracao?: number | string };
    if (r.ok === true) return { ok: true, geracao: Number(r.geracao) };
    if (r.motivo !== "conflito") return { ok: false, motivo: r.motivo ?? "desconhecido" };
  }
  return { ok: false, motivo: "conflito" };
}

/** Quanto uma automação que fala com o cliente espera um fluxo terminar a etapa. */
export const ESPERA_DA_AUTOMACAO_MS = 15 * 60_000;

/**
 * Uma automação vai mandar mensagem a este contato por este número — há um
 * fluxo no MEIO de uma etapa com ele? Se sim, devolve quando tentar de novo.
 *
 * Só com o coordenador ativo, e só para fluxo vivo dono da conversa: é o caso
 * em que a mensagem automática cairia entre a pergunta do fluxo e a resposta
 * do cliente. Agente dono ou pessoa no comando não adiam — a automação já
 * falava por cima deles antes do coordenador, e mudar isso é decisão de
 * produto, não efeito colateral. Falha de leitura = não adia.
 */
export async function adiamentoPorFluxoConduzindo(
  admin: SupabaseClient,
  p: { organizationId: string; contactId: string | null; channelSessionId: string; agora?: Date },
): Promise<string | null> {
  if (p.contactId === null) return null;
  try {
    if (!(await coordenadorAtivoNoCanal(admin, p.organizationId, p.channelSessionId))) return null;
    const { data: conversa } = await admin
      .from("conversations")
      .select("id")
      .eq("organization_id", p.organizationId)
      .eq("contact_id", p.contactId)
      .eq("channel_session_id", p.channelSessionId)
      .eq("is_group", false)
      .maybeSingle();
    const conversationId = (conversa as { id?: string } | null)?.id;
    if (!conversationId) return null;
    const { data: estado } = await admin
      .from("coord_estado_conversa")
      .select("dono_tipo, dono_execution_id")
      .eq("organization_id", p.organizationId)
      .eq("conversation_id", conversationId)
      .maybeSingle();
    const e = estado as { dono_tipo?: string; dono_execution_id?: string | null } | null;
    if (e?.dono_tipo !== "fluxo" || !e.dono_execution_id) return null;
    const { data: execucao } = await admin
      .from("flow_executions")
      .select("status")
      .eq("organization_id", p.organizationId)
      .eq("id", e.dono_execution_id)
      .maybeSingle();
    const status = (execucao as { status?: string } | null)?.status;
    if (status !== "pending" && status !== "running" && status !== "waiting") return null;
    return new Date((p.agora ?? new Date()).getTime() + ESPERA_DA_AUTOMACAO_MS).toISOString();
  } catch {
    return null;
  }
}
