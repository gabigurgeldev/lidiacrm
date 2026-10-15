import { redirect } from "next/navigation";

import { PaginaAjustes } from "@/components/ajustes";
import { traduzir } from "@/lib/i18n/dicionario";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { listSelectableChannels } from "@/lib/channels/selectable";
import { createClient } from "@/lib/supabase/server";
import type { CredentialRow } from "@/hooks/ai/useCredentials";

import { servicoDeVozDaOrganizacao } from "@/lib/ai/voz/servico-da-organizacao";

import { AgentForm } from "../[id]/_components/AgentForm";
import { carregarEscopoDoEditor, provedoresDaInstalacao } from "../_lib/dados-do-editor";
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
    // A lista do ramo é EXPLÍCITA — e uma lista explícita desliga o que não está
    // nela. As skills que a organização instalou ou importou entram junto, para
    // o agente novo não nascer sem o que o dono já escolheu para todos.
    if (inicial.skill_names !== null) {
      const daOrganizacao = escopo.habilidades.filter((h) => h.daOrganizacao && !h.universal).map((h) => h.name);
      inicial = { ...inicial, skill_names: [...new Set([...inicial.skill_names, ...daOrganizacao])].sort() };
    }
  }

  return (
    <PaginaAjustes
      testid="pagina-novo-agente"
      titulo={traduzir("Novo agente", user.idioma)}
      descricao={traduzir(
        "Comece por um modelo pronto para o seu ramo, ou em branco. O agente nasce como rascunho: nada vai para o cliente até você publicar.",
        user.idioma,
      )}
    >
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
        funis={escopo.funis}
        cobertura={escopo.cobertura}
        materiais={escopo.materiais}
        integracoes={escopo.integracoes}
        habilidades={escopo.habilidades}
        emailConfigurado={isEmailConfigured()}
      />
    </PaginaAjustes>
  );
}
