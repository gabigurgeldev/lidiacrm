/**
 * Despausar um `mcp_agent` = devolver ao ar a versão que a pausa tirou.
 *
 * ## Por que existe
 *
 * Pausar um `mcp_agent` limpa `published_version_id` e marca a versão que estava
 * no ar como `superseded` (`pauseAgentAction`, rota `/pause`). A volta não
 * existia: o item "Despausar" da lista ficava desabilitado para esse kind, a
 * action recusava com "Publique uma versão", e o editor só publica RASCUNHO —
 * que um agente pausado não tem. O dono do agente ficava sem caminho pela tela;
 * medido em produção duas vezes (15/10 e 30/10/2026), as duas resolvidas pelo
 * suporte publicando à mão.
 *
 * ## Qual versão volta
 *
 * A `superseded` mais recentemente retirada que já esteve no ar
 * (`published_at` preenchido). A pausa carimba `superseded_at = now()` na versão
 * que tira, então ela é a mais recente por construção. Rascunho nunca publicado
 * não conta: despausar não é publicar coisa nova — isso continua sendo gesto do
 * editor.
 *
 * Republica a MESMA versão (a função SQL aceita `superseded`), sem clonar: o
 * número da versão no ar continua o que era antes da pausa, que é o que o dono
 * espera ver.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { publishAgentVersion, type PublishResult } from "./publish";

export type DespausarResult =
  | PublishResult
  | { ok: false; code: "nada_para_despausar"; message: string };

/**
 * A versão que a pausa (ou o modo "só sugere") tirou do ar: `superseded`, já
 * publicada alguma vez, a mais recentemente retirada. É também a versão que o
 * rascunho do Inbox usa enquanto o agente só sugere
 * (`loadSuggestionOnlyAgentConfig`, mesma regra em SQL) — por isso "voltar a
 * atender" devolve exatamente o agente que estava sugerindo.
 */
export async function ultimaVersaoQueEsteveNoAr(
  admin: SupabaseClient,
  params: { orgId: string; agentId: string },
): Promise<string | null> {
  const { data } = await admin
    .from("ai_agent_versions")
    .select("id, published_at, superseded_at")
    .eq("organization_id", params.orgId)
    .eq("agent_id", params.agentId)
    .eq("status", "superseded")
    .order("superseded_at", { ascending: false, nullsFirst: false })
    .limit(20);

  const candidatas = (data ?? []) as Array<{
    id: string;
    published_at: string | null;
    superseded_at: string | null;
  }>;
  return candidatas.find((v) => v.published_at !== null && v.superseded_at !== null)?.id ?? null;
}

/**
 * Devolve ao ar a versão retirada. `destino` padrão é `atendendo`: despausar é
 * voltar a falar com o cliente — inclusive para o agente que só sugeria, que
 * sai do modo. Quem quer religar SÓ a sugestão passa `so_sugestao`.
 */
export async function despausarAgente(
  admin: SupabaseClient,
  params: { orgId: string; agentId: string; destino?: "atendendo" | "so_sugestao" },
): Promise<DespausarResult> {
  const alvo = await ultimaVersaoQueEsteveNoAr(admin, params);
  if (!alvo) {
    return {
      ok: false,
      code: "nada_para_despausar",
      message: "nada_para_despausar",
    };
  }

  return publishAgentVersion(admin, {
    orgId: params.orgId,
    agentId: params.agentId,
    versionId: alvo,
    destino: params.destino ?? "atendendo",
  });
}
