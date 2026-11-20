/**
 * Publish wrapper around the SQL function fn_publish_ai_agent_version.
 * Spec 10 §4.5.
 *
 * Returns a discriminated result so the caller maps validation errors to 422
 * with a stable error code, and unknown errors to 500.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { lerAmbiente, type FonteDeAmbiente } from "@/lib/instalacao/ambiente";

import { PUBLISH_ERROR_CODES, type PublishErrorCode } from "./validation";

export interface PublishOk {
  ok: true;
  agent_id: string;
  version_id: string;
  previous_version_id: string | null;
  published_at: string;
  /** A versão ficou servindo só o "Sugerir resposta" do Inbox, fora do ar (migration 0255). */
  so_sugestao?: boolean;
}

/**
 * Para onde a versão vai depois de publicada.
 *
 *   - `manter` (padrão): o agente continua no modo em que está. Agente que só
 *     sugere respostas segue só sugerindo — é o que o editor, a API, o reverter e
 *     a proposta aplicada querem: corrigir o texto não é decidir voltar a
 *     falar com o cliente;
 *   - `atendendo`: no ar, atendendo (despausar, "voltar a atender");
 *   - `so_sugestao`: publicada e retirada na MESMA transação, servindo só o
 *     rascunho do Inbox.
 */
export type DestinoDaPublicacao = "manter" | "atendendo" | "so_sugestao";

export interface PublishFail {
  ok: false;
  code: PublishErrorCode | "internal_error";
  message: string;
}

export type PublishResult = PublishOk | PublishFail;

interface PublishRow {
  agent_id: string;
  version_id: string;
  previous_version_id: string | null;
  published_at: string;
}

/**
 * A versão sem credencial escolhida ("a chave desta instalação") tem com o que
 * conversar? O motor resolve nesta ordem (`lib/agent-engine/edge/llm/credentials.ts`):
 * a credencial ativa e validada mais recente do provedor na organização, senão
 * a chave do provedor no `.env` da instalação. Publicar sem nenhuma das duas é
 * publicar um agente que falha em toda mensagem.
 *
 * Mora AQUI, e não na função SQL, porque o banco não enxerga o `.env` do
 * servidor. A função SQL só deixou de recusar `credential_id` nulo (migration
 * 0232); quem decide se o nulo tem cobertura é esta checagem, que roda antes
 * dela em todo caminho que publica (editor, API, revert, proposta aplicada).
 */
export async function versaoSemCredencialTemChave(
  admin: SupabaseClient,
  orgId: string,
  provider: string,
  ambiente: FonteDeAmbiente = process.env,
): Promise<boolean> {
  if (lerAmbiente(ambiente).chavesDeProvedor[provider] === true) return true;
  const { data } = await admin
    .from("ai_provider_credentials")
    .select("id")
    .eq("organization_id", orgId)
    .eq("provider", provider)
    .eq("is_active", true)
    .not("validated_at", "is", null)
    .limit(1);
  return (data ?? []).length > 0;
}

export async function publishAgentVersion(
  admin: SupabaseClient,
  params: { orgId: string; agentId: string; versionId: string; destino?: DestinoDaPublicacao },
): Promise<PublishResult> {
  const { data: versao } = await admin
    .from("ai_agent_versions")
    .select("provider, credential_id")
    .eq("id", params.versionId)
    .eq("organization_id", params.orgId)
    .maybeSingle();
  if (
    versao &&
    versao.credential_id === null &&
    !(await versaoSemCredencialTemChave(admin, params.orgId, versao.provider as string))
  ) {
    return { ok: false, code: "credential_missing", message: "credential_missing" };
  }

  // O modo atual decide o `manter`. Leitura que falha (ou banco ainda sem a
  // coluna da 0255) vira `false`: cai no caminho de sempre — e, se o agente
  // estiver no modo, o CHECK do banco recusa a publicação em vez de pô-lo no ar.
  const { data: agente } = await admin
    .from("ai_agents")
    .select("so_sugestao")
    .eq("id", params.agentId)
    .eq("organization_id", params.orgId)
    .maybeSingle();
  const estaSoSugerindo = (agente as { so_sugestao?: boolean } | null)?.so_sugestao === true;
  const destino = params.destino ?? "manter";
  const soSugestao = destino === "so_sugestao" || (destino === "manter" && estaSoSugerindo);

  // Agente comum indo para o ar: a função de sempre, intocada. A nova só entra
  // quando o modo "só sugere" está em jogo — na ida ou na volta.
  const { data, error } =
    !soSugestao && !estaSoSugerindo
      ? await admin.rpc("fn_publish_ai_agent_version", {
          p_org_id: params.orgId,
          p_agent_id: params.agentId,
          p_version_id: params.versionId,
        })
      : await admin.rpc("fn_publicar_versao_do_agente", {
          p_org_id: params.orgId,
          p_agent_id: params.agentId,
          p_version_id: params.versionId,
          p_so_sugestao: soSugestao,
        });

  if (error) {
    // Postgres P0001 with the reason as message.
    const raw = (error.message ?? "").trim();
    if (PUBLISH_ERROR_CODES.has(raw)) {
      return { ok: false, code: raw as PublishErrorCode, message: raw };
    }
    return { ok: false, code: "internal_error", message: raw || "publish_failed" };
  }

  const row = Array.isArray(data) ? (data[0] as PublishRow | undefined) : (data as PublishRow | null);
  if (!row) {
    return { ok: false, code: "internal_error", message: "no_row_returned" };
  }
  return {
    ok: true,
    agent_id: row.agent_id,
    version_id: row.version_id,
    previous_version_id: row.previous_version_id,
    published_at: row.published_at,
    so_sugestao: soSugestao,
  };
}
