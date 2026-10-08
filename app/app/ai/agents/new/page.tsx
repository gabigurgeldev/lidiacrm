import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { listSelectableChannels } from "@/lib/channels/selectable";
import { createClient } from "@/lib/supabase/server";
import type { CredentialRow } from "@/hooks/ai/useCredentials";

import { servicoDeVozDaOrganizacao } from "@/lib/ai/voz/servico-da-organizacao";

import { AgentForm } from "../[id]/_components/AgentForm";
import { carregarEscopoDoEditor, provedoresDaInstalacao } from "../_lib/dados-do-editor";
import { isEmailConfigured } from "@/lib/email/resend";

export const dynamic = "force-dynamic";

const CREDENTIAL_COLUMNS =
  "id, organization_id, provider, label, api_key_last4, validated_at, validation_error, models_available, is_active, created_by, created_at, updated_at";

export default async function NewAgentPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    redirect("/403");
  }

  const supabase = await createClient();
  // O MESMO escopo da página de edição (funis, cobertura, acervo, integrações):
  // sem ele, o formulário de criação dizia "nenhum funil" e "nenhum material"
  // para quem tinha os dois.
  const [credentialsRes, channelSessions, escopo] = await Promise.all([
    supabase
      .from("ai_provider_credentials_safe")
      .select(CREDENTIAL_COLUMNS)
      .eq("organization_id", activeOrg.orgId),
    listSelectableChannels(supabase, activeOrg.orgId),
    carregarEscopoDoEditor(supabase, activeOrg.orgId),
  ]);

  const credentials = (credentialsRes.data ?? []) as unknown as CredentialRow[];

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <AgentForm
        mode="create"
        credentials={credentials}
        provedoresDaInstalacao={provedoresDaInstalacao()}
        servicoDeVoz={await servicoDeVozDaOrganizacao(supabase, activeOrg.orgId)}
        channelSessions={channelSessions}
        funis={escopo.funis}
        cobertura={escopo.cobertura}
        materiais={escopo.materiais}
        integracoes={escopo.integracoes}
        emailConfigurado={isEmailConfigured()}
      />
    </div>
  );
}
