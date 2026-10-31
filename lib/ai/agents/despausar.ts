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

export async function despausarAgente(
  admin: SupabaseClient,
  params: { orgId: string; agentId: string },
): Promise<DespausarResult> {
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
  const alvo = candidatas.find((v) => v.published_at !== null && v.superseded_at !== null);
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
    versionId: alvo.id,
  });
}
