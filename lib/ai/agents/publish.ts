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
}

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
  params: { orgId: string; agentId: string; versionId: string },
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

  const { data, error } = await admin
    .rpc("fn_publish_ai_agent_version", {
      p_org_id: params.orgId,
      p_agent_id: params.agentId,
      p_version_id: params.versionId,
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
  };
}
