"use client";
/**
 * Tabs do detalhe de agent. Wave 12 (S-13.12) entrega Test, Runs e History.
 * A aba Teste ensaia o formulário vivo (`TestPanel`, `lib/agent-engine/ensaio`).
 */
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { GATILHO_DA_ABA, SEGMENTADO_ABAS } from "@/components/ajustes";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/hooks/i18n/useT";
import { AgentForm, type ChannelSessionLite, type VersaoDoFormulario } from "./AgentForm";
import type { CoberturaPorFunil } from "./FunisDoAgente";
import type { MaterialDoAcervo } from "./BasesDoAgente";
import type { IntegracaoDoAcervo } from "./IntegracoesDoAgente";
import type { FunilDaResposta } from "@/hooks/pipelines/usePipelines";
import { TestPanel } from "./TestPanel";
import { RunsTable } from "./RunsTable";
import { UsoDasCapacidades } from "./UsoDasCapacidades";
import { VersionHistory } from "./VersionHistory";
import { ProposalsPanel } from "./ProposalsPanel";
import type { AgentRow } from "@/hooks/ai/useAgent";
import type { AgentVersionRow } from "@/hooks/ai/useAgentVersions";
import type { CredentialRow } from "@/hooks/ai/useCredentials";
import type { ServicoDeVoz } from "@/lib/ai/voz/vozes";

interface Props {
  /** Funis da org, para a marcação de escopo do agente (spec 17 passo 3). */
  funis?: FunilDaResposta[];
  cobertura?: CoberturaPorFunil;
  /** O acervo da organização, para a seção "o que ele consulta" (0181). */
  materiais?: MaterialDoAcervo[];
  integracoes?: IntegracaoDoAcervo[];
  emailConfigurado?: boolean;
  agent: AgentRow;
  draft: AgentVersionRow | null;
  published: AgentVersionRow | null;
  /** De onde o formulário se hidrata — ver `lib/ai/agents/versoes-da-tela.ts`. */
  base?: AgentVersionRow | null;
  /** Rascunho anterior à publicada: existe, mas não abre nem publica. */
  draftObsoleto?: AgentVersionRow | null;
  versions: AgentVersionRow[];
  credentials: CredentialRow[];
  /** Provedores cuja chave veio na instalação — ver `AgentForm`. */
  provedoresDaInstalacao?: string[];
  /** Por qual serviço a organização fala — ver `AgentForm`. */
  servicoDeVoz?: ServicoDeVoz | null;
  channelSessions: ChannelSessionLite[];
  routerMembership?: { routerId: string; routerName: string } | null;
  readOnly?: boolean;
}

/**
 * A aba vive na URL (`?aba=`), em português: link colado no chat abre onde
 * deveria, e voltar do detalhe de uma execução não joga a pessoa na
 * configuração. O valor interno segue o antigo — os e2e clicam pelo rótulo.
 */
const ABA_DA_URL = {
  configuracao: "configuration",
  teste: "test",
  capacidades: "capacidades",
  execucoes: "runs",
  historico: "history",
  propostas: "proposals",
} as const;
type Aba = (typeof ABA_DA_URL)[keyof typeof ABA_DA_URL];
const URL_DA_ABA = Object.fromEntries(Object.entries(ABA_DA_URL).map(([u, a]) => [a, u])) as Record<Aba, string>;

export function abaDaUrl(valor: string | null): Aba {
  return valor !== null && valor in ABA_DA_URL ? ABA_DA_URL[valor as keyof typeof ABA_DA_URL] : "configuration";
}

export function AgentTabs(props: Props) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = abaDaUrl(params.get("aba"));
  const setTab = (proxima: Aba) => {
    const q = new URLSearchParams(params.toString());
    if (proxima === "configuration") q.delete("aba");
    else q.set("aba", URL_DA_ABA[proxima]);
    const qs = q.toString();
    // `scroll: false`: trocar de aba não é ir para outra página.
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  // O que o formulário salvaria agora — é o que a aba Teste ensaia, sem salvar.
  const [versaoDoFormulario, setVersaoDoFormulario] = React.useState<VersaoDoFormulario | null>(null);

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as Aba)}
      className="flex flex-col gap-4"
    >
      {/* No segmentado do kit de Ajustes. */}
      <TabsList className={SEGMENTADO_ABAS}>
        <TabsTrigger value="configuration" className={GATILHO_DA_ABA}>{t("Configuração")}</TabsTrigger>
        <TabsTrigger value="test" className={GATILHO_DA_ABA}>{t("Teste")}</TabsTrigger>
        <TabsTrigger value="capacidades" className={GATILHO_DA_ABA}>{t("Capacidades")}</TabsTrigger>
        <TabsTrigger value="runs" className={GATILHO_DA_ABA}>{t("Execuções")}</TabsTrigger>
        <TabsTrigger value="history" className={GATILHO_DA_ABA}>{t("Histórico")}</TabsTrigger>
        <TabsTrigger value="proposals" className={GATILHO_DA_ABA}>{t("Propostas")}</TabsTrigger>
      </TabsList>

      {/*
        `forceMount`: o formulário fica montado (só escondido) nas outras abas.
        Sem isso, ir até Teste DESMONTAVA o formulário e o que estava sem salvar
        sumia — justamente o que a aba Teste existe para experimentar.
      */}
      <TabsContent value="configuration" className="m-0 data-[state=inactive]:hidden" forceMount>
        <AgentForm
          aoMudarVersao={setVersaoDoFormulario}
          mode="edit"
          agent={props.agent}
          draft={props.draft}
          published={props.published}
          base={props.base}
          draftObsoleto={props.draftObsoleto}
          credentials={props.credentials}
          provedoresDaInstalacao={props.provedoresDaInstalacao}
          servicoDeVoz={props.servicoDeVoz}
          channelSessions={props.channelSessions}
          funis={props.funis}
          cobertura={props.cobertura}
          materiais={props.materiais}
          integracoes={props.integracoes}
          emailConfigurado={props.emailConfigurado}
          routerMembership={props.routerMembership}
          readOnly={props.readOnly}
        />
      </TabsContent>

      <TabsContent value="test" className="m-0">
        <TestPanel agent={props.agent} versao={versaoDoFormulario} readOnly={props.readOnly} />
      </TabsContent>

      <TabsContent value="capacidades" className="m-0">
        <UsoDasCapacidades agentId={props.agent.id} active={tab === "capacidades"} />
      </TabsContent>

      <TabsContent value="runs" className="m-0">
        <RunsTable agentId={props.agent.id} active={tab === "runs"} />
      </TabsContent>

      <TabsContent value="proposals" className="m-0">
        <ProposalsPanel
          agentId={props.agent.id}
          active={tab === "proposals"}
          readOnly={props.readOnly}
        />
      </TabsContent>

      <TabsContent value="history" className="m-0">
        <VersionHistory
          agentId={props.agent.id}
          versions={props.versions}
          readOnly={props.readOnly}
        />
      </TabsContent>
    </Tabs>
  );
}
