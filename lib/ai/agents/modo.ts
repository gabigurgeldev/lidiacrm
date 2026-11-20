/**
 * Modo "só sugere respostas" (migration 0255) — ligar e desligar.
 *
 * ## O pedido
 *
 * Uma empresa não quer a IA falando com o cliente, mas quer o "Sugerir
 * resposta" do Inbox, que gera o rascunho com o prompt, o modelo e a chave do
 * agente. Antes não dava: o rascunho procurava o agente PUBLICADO no número, e
 * publicado é o que atende. Pausar desligava as duas coisas.
 *
 * ## Por que o agente fica FORA DO AR
 *
 * Toda porta por onde a IA fala com o cliente (turno de entrada, roteador,
 * coordenador, follow-up, operador, o portão do drain, o picker de atribuição)
 * decide "atende?" por `published_version_id`. No modo "só sugere" o ponteiro é
 * nulo — para o motor, é um agente pausado, semântica já medida e vigiada. Só
 * o rascunho do Inbox lê a flag (`loadSuggestionOnlyAgentConfig`). Uma trava
 * "no ar, mas calado" exigiria um filtro novo em cada porta, e a porta
 * esquecida seria o agente respondendo para quem pediu silêncio.
 *
 * ## Os três estados, e as transições daqui
 *
 *   atendendo ──ligarSoSugestao──▶ só sugere   (retira a versão do ar)
 *   pausado   ──ligarSoSugestao──▶ só sugere   (a última que esteve no ar)
 *   só sugere ──despausarAgente──▶ atendendo   (lib/ai/agents/despausar.ts)
 *   só sugere ──pauseAgentAction─▶ pausado     (desliga a flag)
 *
 * Publicar uma versão nova no editor com o agente "só sugerindo" mantém o modo
 * (`publishAgentVersion`, destino `manter`): corrigir o texto não é decidir
 * voltar a falar com o cliente.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ultimaVersaoQueEsteveNoAr } from "./despausar";
import { publishAgentVersion, type PublishResult } from "./publish";

export type LigarSoSugestaoResult =
  | PublishResult
  | {
      ok: false;
      code: "not_found" | "agent_archived" | "modo_indisponivel" | "nada_para_sugerir";
      message: string;
    };

const falha = (code: "not_found" | "agent_archived" | "modo_indisponivel" | "nada_para_sugerir") =>
  ({ ok: false, code, message: code }) as const;

export async function ligarSoSugestao(
  admin: SupabaseClient,
  params: { orgId: string; agentId: string },
): Promise<LigarSoSugestaoResult> {
  const { data } = await admin
    .from("ai_agents")
    .select("id, kind, published_version_id, archived_at")
    .eq("id", params.agentId)
    .eq("organization_id", params.orgId)
    .maybeSingle();
  const agente = data as {
    kind: string | null;
    published_version_id: string | null;
    archived_at: string | null;
  } | null;

  if (!agente) return falha("not_found");
  if (agente.archived_at) return falha("agent_archived");
  // O `rag_bot` legado não tem versão: a config dele mora na própria linha e
  // quem o executa é o worker antigo, que não sabe deste modo. Recusar é
  // melhor que fingir que ligou.
  if (agente.kind !== "mcp_agent") return falha("modo_indisponivel");

  // No ar: é essa versão que passa a só sugerir. Fora do ar: a última que
  // esteve — a mesma que um "despausar" devolveria.
  const versao = agente.published_version_id ?? (await ultimaVersaoQueEsteveNoAr(admin, params));
  if (!versao) return falha("nada_para_sugerir");

  return publishAgentVersion(admin, {
    orgId: params.orgId,
    agentId: params.agentId,
    versionId: versao,
    destino: "so_sugestao",
  });
}
