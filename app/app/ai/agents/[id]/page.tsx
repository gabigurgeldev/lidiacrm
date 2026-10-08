import { notFound, redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { listSelectableChannels } from "@/lib/channels/selectable";
import { createClient } from "@/lib/supabase/server";
import type { AgentRow } from "@/hooks/ai/useAgent";
import type { AgentVersionRow } from "@/hooks/ai/useAgentVersions";
import type { CredentialRow } from "@/hooks/ai/useCredentials";

import { AgentEditorClient } from "./_client";
import { isEmailConfigured } from "@/lib/email/resend";
import { AgentTabs } from "./_components/AgentTabs";
import { carregarEscopoDoEditor, provedoresDaInstalacao } from "../_lib/dados-do-editor";
import { servicoDeVozDaOrganizacao } from "@/lib/ai/voz/servico-da-organizacao";
import { escolherVersoesDaTela } from "@/lib/ai/agents/versoes-da-tela";

export const dynamic = "force-dynamic";

const AGENT_COLUMNS =
  "id, organization_id, name, description, model, system_prompt, is_active, is_default, kind, priority, published_version_id, archived_at, config, guardrails, active_kb_version_id, created_at, updated_at";

const VERSION_COLUMNS =
  "id, organization_id, agent_id, version_number, system_prompt, provider, model, credential_id, tool_ids, trigger_config, channel_session_id, max_steps, token_budget, cost_budget_cents, history_message_window, history_token_window, handoff_keywords, handoff_tool_enabled, cases_enabled, split_messages, split_max_chars, reply_as_audio, reply_as_audio_mirror, human_request_try_first, audio_voice, followup, operator_enabled, operator_model, operator_tool_ids, status, published_at, superseded_at, created_at, created_by,pipeline_ids,knowledge_source_ids,api_endpoint_ids";

const CREDENTIAL_COLUMNS =
  "id, organization_id, provider, label, api_key_last4, validated_at, validation_error, models_available, is_active, created_by, created_at, updated_at";

export default async function AgentEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    redirect("/403");
  }

  const supabase = await createClient();
  const { data: agentRow } = await supabase
    .from("ai_agents")
    .select(AGENT_COLUMNS)
    .eq("id", id)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();

  if (!agentRow) notFound();

  const agent = agentRow as unknown as AgentRow;
  const readOnly = ROLE_RANK[activeOrg.role] < ROLE_RANK.admin;

  // Caminho legado: rag_bot continua usando o editor pré-EPIC-13.
  if ((agent.kind ?? "rag_bot") !== "mcp_agent") {
    return (
      <div className="flex h-full flex-col gap-6 p-6">
        <AgentEditorClient agentId={agent.id} initialData={agent} readOnly={readOnly} />
      </div>
    );
  }

  // mcp_agent: busca versions + lookups.
  const [versionsRes, credentialsRes, channelSessions, routerMemberRes, escopo] =
    await Promise.all([
    supabase
      .from("ai_agent_versions")
      .select(VERSION_COLUMNS)
      .eq("organization_id", activeOrg.orgId)
      .eq("agent_id", id)
      .order("version_number", { ascending: false }),
    supabase
      .from("ai_provider_credentials_safe")
      .select(CREDENTIAL_COLUMNS)
      .eq("organization_id", activeOrg.orgId),
    listSelectableChannels(supabase, activeOrg.orgId),
    supabase
      .from("ai_router_members")
      .select("router_id, ai_routers(name)")
      .eq("organization_id", activeOrg.orgId)
      .eq("agent_id", id)
      .limit(1)
      .maybeSingle(),
    // Funis (com a cobertura de cada um), acervo e integrações: o mesmo
    // carregador da página de criação — ver `_lib/dados-do-editor.ts`.
    carregarEscopoDoEditor(supabase, activeOrg.orgId),
  ]);

  const versions = (versionsRes.data ?? []) as unknown as AgentVersionRow[];
  const credentials = (credentialsRes.data ?? []) as unknown as CredentialRow[];
  const routerMemberRow = routerMemberRes.data as { router_id: string; ai_routers: { name: string } | null } | null;
  const routerMembership = routerMemberRow
    ? { routerId: routerMemberRow.router_id, routerName: routerMemberRow.ai_routers?.name ?? "roteador" }
    : null;

  // A regra mora em `lib/ai/agents/versoes-da-tela.ts` (pura e testada): rascunho
  // VIGENTE > publicada > última versão que existiu. Antes, o rascunho vencia
  // sempre — inclusive quando era mais antigo que a publicada — e um agente
  // pausado (sem rascunho e sem publicada) abria no texto padrão, que é como o
  // prompt "sumia".
  const { draft, published, base, draftObsoleto } = escolherVersoesDaTela(versions, agent.published_version_id ?? null);

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <AgentTabs
        agent={agent}
        draft={draft}
        published={published}
        base={base}
        draftObsoleto={draftObsoleto}
        versions={versions}
        credentials={credentials}
        provedoresDaInstalacao={provedoresDaInstalacao()}
        servicoDeVoz={await servicoDeVozDaOrganizacao(supabase, activeOrg.orgId)}
        channelSessions={channelSessions}
        funis={escopo.funis}
        cobertura={escopo.cobertura}
        materiais={escopo.materiais}
        integracoes={escopo.integracoes}
        emailConfigurado={isEmailConfigured()}
        routerMembership={routerMembership}
        readOnly={readOnly}
      />
    </div>
  );
}
