import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { listSelectableChannels } from "@/lib/channels/selectable";
import { createClient } from "@/lib/supabase/server";
import type { CredentialRow } from "@/hooks/ai/useCredentials";

import { lerAmbiente } from "@/lib/instalacao/ambiente";
import { servicoDeVozDaOrganizacao } from "@/lib/ai/voz/servico-da-organizacao";

import { AgentForm } from "../[id]/_components/AgentForm";
import type { IntegracaoDoAcervo } from "../[id]/_components/IntegracoesDoAgente";
import { isEmailConfigured } from "@/lib/email/resend";
import { capacidadesPadraoDoOnboarding } from "@/lib/ai/agents/capacidades-padrao";
import {
  MODELOS_DE_AGENTE,
  escolhaDaUrl,
  montarModelo,
  type CamposDoModelo,
} from "@/lib/ai/agents/modelos-por-nicho";
import { JEITOS_DE_FALAR, ondeTrabalha } from "@/lib/ai/agents/tons";

import { EscolhaDeModelo } from "./_components/EscolhaDeModelo";

export const dynamic = "force-dynamic";

const CREDENTIAL_COLUMNS =
  "id, organization_id, provider, label, api_key_last4, validated_at, validation_error, models_available, is_active, created_by, created_at, updated_at";

/**
 * Os provedores cuja chave veio na INSTALAÇÃO (`.env`), não da tela de
 * Credenciais.
 *
 * Sai de `lerAmbiente`, a mesma leitura que o retrato da instalação usa — uma
 * segunda lista de nomes de variável divergiria no dia em que um provedor novo
 * entrasse.
 */
function provedoresDaInstalacao(): string[] {
  const a = lerAmbiente();
  return Object.entries(a.chavesDeProvedor)
    .filter(([, tem]) => tem)
    .map(([id]) => id);
}

export default async function NewAgentPage({
  searchParams,
}: {
  searchParams: Promise<{ modelo?: string | string[]; tom?: string | string[] }>;
}) {
  const escolha = escolhaDaUrl(await searchParams);
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    redirect("/403");
  }

  const supabase = await createClient();
  const [credentialsRes, channelSessions, integracoesRes] = await Promise.all([
    supabase
      .from("ai_provider_credentials_safe")
      .select(CREDENTIAL_COLUMNS)
      .eq("organization_id", activeOrg.orgId),
    listSelectableChannels(supabase, activeOrg.orgId),
    // Integrações via API (0223): sem a lista, o card diria "nenhuma integração"
    // para quem já cadastrou — o estado vazio mentiria no agente novo.
    supabase
      .from("ai_api_integrations")
      .select(
        "id, nome, identidade_modo, identidade_endpoint_id, ultimo_teste_ok, circuito_aberto_ate, endpoints:ai_api_endpoints!ai_api_endpoints_integration_id_fkey(id, slug, titulo, modo, exige_identidade, ativo)",
      )
      .eq("organization_id", activeOrg.orgId)
      .is("arquivada_em", null)
      .eq("ativo", true)
      .order("created_at", { ascending: true }),
  ]);

  const credentials = (credentialsRes.data ?? []) as unknown as CredentialRow[];

  // O modelo escreve "Você atende os clientes de <negócio>, que é: <ramo>" — o
  // mesmo "onde trabalha" do agente do onboarding. O ramo é o que o dono
  // respondeu no primeiro passo; falha de leitura só tira a frase do ramo.
  let inicial: CamposDoModelo | undefined;
  if (escolha.modelo) {
    const { data: org } = await supabase
      .from("organizations")
      .select("onboarding_state")
      .eq("id", activeOrg.orgId)
      .maybeSingle();
    const estado = (org?.onboarding_state ?? null) as { welcome?: { o_que_faz?: string } } | null;
    inicial = montarModelo(escolha.modelo, escolha.tom, {
      onde: ondeTrabalha(activeOrg.name, estado?.welcome?.o_que_faz || undefined),
      capacidades: capacidadesPadraoDoOnboarding(),
    });
  }

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <EscolhaDeModelo
        modelos={MODELOS_DE_AGENTE.map(({ id, comoSeApresenta, resumo }) => ({ id, comoSeApresenta, resumo }))}
        jeitos={JEITOS_DE_FALAR}
        modelo={escolha.modelo?.id ?? null}
        tom={escolha.tom}
      />
      <AgentForm
        // Trocar de modelo remonta o formulário: o estado dele nasce da escolha.
        key={`${escolha.modelo?.id ?? "em-branco"}:${escolha.tom}`}
        inicial={inicial}
        mode="create"
        credentials={credentials}
        provedoresDaInstalacao={provedoresDaInstalacao()}
        servicoDeVoz={await servicoDeVozDaOrganizacao(supabase, activeOrg.orgId)}
        channelSessions={channelSessions}
        integracoes={(integracoesRes.data ?? []) as unknown as IntegracaoDoAcervo[]}
        emailConfigurado={isEmailConfigured()}
      />
    </div>
  );
}
