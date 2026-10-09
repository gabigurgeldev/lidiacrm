"use client";
/**
 * Form principal de configuração de um mcp_agent (Spec 12 §3 / S-13.11).
 *
 * Renderiza o agent + sua draft mais recente. Carregamento inicial vem do
 * Server Component pai (initial props). Mutations passam por:
 *   - `saveAgentDraftAction` (cria draft nova ou PATCH na existente)
 *   - `publishAgentAction` (versão draft → published; flip atômico via fn)
 *
 * Estados visíveis ao usuário:
 *   - "Publicado vN" (sem draft, valores espelham published)
 *   - "Rascunho vN+1" (sem published)
 *   - "Publicado vN + Rascunho vM" (formulário mostra a draft)
 *
 * Este arquivo é o ORQUESTRADOR: estado, validação, salvar e publicar. Cada
 * seção da tela mora num arquivo em `editor/` e recebe o mesmo `PropsDaSecao`.
 * Antes era um arquivo de 1.200 linhas com treze cartões em duas colunas; agora
 * é uma coluna, com índice de seções ao lado e os ajustes que quase ninguém
 * mexe atrás de "Ajustes avançados".
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Segmentado } from "@/components/ajustes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { CaretDown } from "@/lib/ui/icons";

import { TETO_TOOLS_POR_AGENTE } from "@/lib/mcp/tools/selecao-por-pacote";
import type { ServicoDeVoz } from "@/lib/ai/voz/vozes";

import { useModelMeta } from "./ModelPicker";
import { CHAVE_DA_INSTALACAO, findCredential } from "./CredentialPicker";
import { PainelDoOperador } from "./PainelDoOperador";
import { PainelDeSeguranca } from "./PainelDeSeguranca";
import type { MaterialDoAcervo } from "./BasesDoAgente";
import type { IntegracaoDoAcervo } from "./IntegracoesDoAgente";
import { FunisDoAgente, type CoberturaPorFunil } from "./FunisDoAgente";
import { PublishConfirmDialog } from "./PublishConfirmDialog";
import {
  saveAgentDraftAction,
  publishAgentAction,
  createMcpAgentAction,
} from "../_actions";

import {
  avancadoTemErro,
  buildState,
  toVersionPayload,
  type FormState,
  type PropsDaSecao,
  type VersaoDoFormulario,
} from "./editor/estado";
import { NavegacaoDeSecoes } from "./editor/NavegacaoDeSecoes";
import { AncoraDaSecao } from "./editor/pecas";
import { SecaoAvancada } from "./editor/SecaoAvancada";
import { SecaoCapacidades } from "./editor/SecaoCapacidades";
import { SecaoEstilo } from "./editor/SecaoEstilo";
import { SecaoFollowup } from "./editor/SecaoFollowup";
import { SecaoGatilho } from "./editor/SecaoGatilho";
import { SecaoIdentidade } from "./editor/SecaoIdentidade";
import { SecaoInstrucoes } from "./editor/SecaoInstrucoes";
import { SecaoInteligencia } from "./editor/SecaoInteligencia";
import { SecaoNumero } from "./editor/SecaoNumero";
import { SecaoPessoa } from "./editor/SecaoPessoa";

import { versionCreateSchema, agentMcpCreateSchema } from "@/lib/ai/agents/validation";
import type { SelectableChannel as ChannelSessionLite } from "@/lib/channels/selectable";
import type { AgentRow } from "@/hooks/ai/useAgent";
import type { AgentVersionRow } from "@/hooks/ai/useAgentVersions";
import type { CredentialRow } from "@/hooks/ai/useCredentials";
import { credentialStatus } from "@/hooks/ai/useCredentials";
import type { FunilDaResposta } from "@/hooks/pipelines/usePipelines";

/**
 * O canal oferecido no seletor é exatamente o que `listSelectableChannels`
 * devolve — alias, e não uma cópia da forma, para que a tela não possa divergir
 * de quem monta a lista (é lá que mora o filtro de canal arquivado).
 */
export type { ChannelSessionLite };
export type { VersaoDoFormulario };

interface BaseProps {
  credentials: CredentialRow[];
  /**
   * Provedores cujas chaves vieram na INSTALAÇÃO (o `.env`), e não da tela de
   * Credenciais. Sem isto, o editor exigia uma linha em `ai_provider_credentials`
   * que a instalação pelo kit nunca cria — e o dono caía numa tela onde não
   * conseguia salvar nada.
   */
  provedoresDaInstalacao?: string[];
  channelSessions: ChannelSessionLite[];
  /**
   * Por qual serviço esta organização fala (`servicoDeVozDaOrganizacao`) —
   * `null` = nenhum. Sem serviço o toggle "Responder em áudio" fica
   * desabilitado, com o que falta — um toggle que liga e não faz nada seria a
   * falha-em-verde. Com serviço, a lista de vozes é a DELE.
   */
  servicoDeVoz?: ServicoDeVoz | null;
  routerMembership?: { routerId: string; routerName: string } | null;
  readOnly?: boolean;
}

interface EditProps extends BaseProps {
  mode: "edit";
  agent: AgentRow;
  /** Rascunho VIGENTE (mais novo que a publicada) — `null` se não há. */
  draft: AgentVersionRow | null;
  published: AgentVersionRow | null;
  /**
   * A versão de onde o formulário se hidrata: rascunho vigente > publicada >
   * última que existiu. Decidida em `lib/ai/agents/versoes-da-tela.ts`.
   */
  base?: AgentVersionRow | null;
  /** Rascunho anterior à publicada — mostrado como aviso, nunca aberto. */
  draftObsoleto?: AgentVersionRow | null;
}

interface CreateProps extends BaseProps {
  mode: "create";
  /**
   * Campos que um modelo de agente por ramo já preencheu
   * (`lib/ai/agents/modelos-por-nicho.ts`). Só o PONTO DE PARTIDA: nada é salvo
   * até o Criar, e tudo continua editável.
   */
  inicial?: Partial<FormState>;
}

type Props = (EditProps | CreateProps) & {
  /**
   * Os funis da organização, para a marcação de escopo (spec 17 passo 3).
   *
   * Vem por PROP e não por hook: a página já é server component e busca o resto
   * do contexto lá: um fetch client-side aqui faria a lista piscar vazia no
   * primeiro render, e "nenhum funil" é exatamente o estado que esta tela usa
   * para dizer algo importante.
   */
  funis?: FunilDaResposta[];
  /** Quanto de cada funil o assistente sabe percorrer (spec 17 passo 4). */
  cobertura?: CoberturaPorFunil;
  /**
   * O acervo da organização, para o assistente escolher o que consulta (0181).
   *
   * Vem por PROP pelo mesmo motivo dos funis: a página já é server component, e
   * um fetch client-side faria a lista piscar vazia no primeiro render — sendo
   * que "nenhum material" é exatamente o estado que esta seção usa para dizer
   * algo importante.
   */
  materiais?: MaterialDoAcervo[];
  /** Integrações via API da organização (0223), com os endpoints — por prop, pelo mesmo motivo. */
  integracoes?: IntegracaoDoAcervo[];
  /** O envio de e-mail está configurado? A verificação por código depende dele. */
  emailConfigurado?: boolean;
  /**
   * Avisado a cada mudança com a versão que o formulário SALVARIA — é o que o
   * painel Testar ensaia. Testar o que está na tela, e não o último salvo, é o
   * ponto: quem ajusta o prompt quer ver o efeito antes de decidir guardar.
   */
  aoMudarVersao?: (versao: VersaoDoFormulario) => void;
};

type Papel = "conversa" | "operacao" | "seguranca";

export function AgentForm(props: Props) {
  const t = useT();
  const funis = props.funis ?? [];
  const router = useRouter();
  const isEdit = props.mode === "edit";
  const readOnly = props.readOnly ?? false;

  const baseline = React.useMemo(() => {
    if (isEdit) {
      // `base` já traz a regra (rascunho vigente > publicada > última versão).
      // O fallback existe para chamadores que ainda não a passam; sem ele, um
      // agente pausado abriria no texto padrão e o prompt "sumiria".
      const ref = props.base ?? props.draft ?? props.published;
      return buildState({ agent: props.agent, version: ref, servicoDeVoz: props.servicoDeVoz });
    }
    return { ...buildState({ version: null, servicoDeVoz: props.servicoDeVoz }), ...props.inicial };
  }, [isEdit, props]);

  const [form, setForm] = React.useState<FormState>(baseline);
  const aoMudarVersao = props.aoMudarVersao;
  React.useEffect(() => {
    aoMudarVersao?.(toVersionPayload(form));
  }, [form, aoMudarVersao]);
  const [saving, setSaving] = React.useState(false);
  const [publishing, setPublishing] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  /**
   * Qual papel está aberto. Estado LOCAL e não rota: trocar de papel não é
   * navegação — o rascunho é um só, e uma URL por papel faria o usuário achar
   * que salvou um e não o outro.
   */
  const [papel, setPapel] = React.useState<Papel>("conversa");
  const [avancadoAberto, setAvancadoAberto] = React.useState(false);

  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);

  function patch(p: Partial<FormState>) {
    setForm((prev) => ({ ...prev, ...p }));
  }

  const cred = findCredential(props.credentials, form.credential_id);
  const credSt = cred ? credentialStatus(cred) : null;
  const channelSession = props.channelSessions.find((c) => c.id === form.channel_session_id);
  const modelMeta = useModelMeta(form.provider, form.model);

  // ---------------------------------------------------------------------
  // Validação (espelha versionCreateSchema, no client; server revalida).
  // ---------------------------------------------------------------------
  const validation = React.useMemo(() => {
    const errors: Record<string, string> = {};
    // As mensagens abaixo aparecem embaixo do campo ANTES de a pessoa tentar
    // salvar, então são escritas como INSTRUÇÃO ("dê um nome") e não como
    // acusação ("nome obrigatório") — um formulário recém-aberto acusando o
    // usuário de errar é a primeira coisa que ele vê nesta tela.
    if (form.name.trim().length === 0) errors.name = t("Dê um nome para este agente.");
    if (form.name.length > 120) errors.name = t("O nome pode ter até 120 caracteres.");
    if (form.system_prompt.trim().length < 10)
      errors.system_prompt = t("Escreva as instruções do agente (pelo menos uma frase).");
    // `.trim()` porque é o que o servidor mede: `z.string().trim().max(20000)`
    // em lib/ai/agents/validation.ts — o trim roda ANTES do max. Duas réguas
    // diferentes barrariam aqui um texto que o servidor aceitaria.
    const tamanhoDoPrompt = form.system_prompt.trim().length;
    if (tamanhoDoPrompt > 20000)
      errors.system_prompt =
        `${t("As instruções têm")} ${tamanhoDoPrompt.toLocaleString("pt-BR")} ${t("caracteres, e o máximo é 20.000. Corte")} ` +
        `${(tamanhoDoPrompt - 20000).toLocaleString("pt-BR")} ${t("para conseguir salvar.")}`;
    if (!form.model) errors.model = t("Escolha o modelo de inteligência artificial.");
    if (!form.credential_id)
      errors.credential_id = t("Escolha a chave de acesso da empresa de inteligência artificial.");
    // Escolher "a chave desta instalação" para um provedor que a instalação NÃO
    // tem seria publicar um agente que morre em toda mensagem. A mesma recusa
    // existe no servidor (rota de versões); aqui ela chega antes do clique.
    if (
      form.credential_id === CHAVE_DA_INSTALACAO &&
      !(props.provedoresDaInstalacao ?? []).includes(form.provider)
    )
      errors.credential_id = `${t("Esta instalação não tem chave de")} ${form.provider}. ${t("Escolha outra empresa de IA ou cadastre uma chave.")}`;
    if (!form.channel_session_id)
      errors.channel_session_id = t("Escolha por qual número de WhatsApp ele atende.");
    if (form.tool_ids.length > TETO_TOOLS_POR_AGENTE)
      errors.tool_ids = `${t("Máximo de")} ${TETO_TOOLS_POR_AGENTE} ${t("capacidades por agente.")}`;

    // Tenta o schema completo:
    if (Object.keys(errors).length === 0) {
      const parsed = versionCreateSchema.safeParse(toVersionPayload(form));
      if (!parsed.success) {
        const flat = parsed.error.flatten();
        const first = Object.entries(flat.fieldErrors)[0];
        if (first) errors[first[0]] = first[1]?.[0] ?? t("Campo inválido.");
      }
    }
    return errors;
  }, [form, t, props.provedoresDaInstalacao]);

  const isValid = Object.keys(validation).length === 0;
  // Um erro num campo avançado abre a seção: esconder o campo que impede o
  // Salvar seria pedir ao dono que conserte o que ele não vê.
  const mostrarAvancado = avancadoAberto || avancadoTemErro(validation);

  const publishBlockReason = React.useMemo(() => {
    if (!isEdit) return t("Salve o agente antes de publicar.");
    if (!props.draft) return t("Sem rascunho para publicar.");
    if (!isValid) return t("Resolva os erros do formulário.");
    if (dirty) return t("Salve o rascunho antes de publicar.");
    if (!cred) return t("Escolha a chave de acesso da empresa de inteligência artificial.");
    if (credSt !== "validated")
      return `${t("Credencial")} ${form.provider} ${credSt === "invalid" ? t("inválida") : t("ainda não validada")}.`;
    if (!channelSession) return t("Escolha por qual número de WhatsApp ele atende.");
    if (channelSession.status !== "working" && channelSession.status !== "WORKING")
      return `${t("Número WhatsApp não está conectado (status:")} ${channelSession.status}).`;
    return null;
  }, [isEdit, props, isValid, dirty, cred, credSt, form.provider, channelSession, t]);

  // ---------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------

  async function handleSave() {
    if (!isValid) {
      const first = Object.values(validation)[0];
      toast.error(first ?? t("Formulário inválido."));
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        const res = await saveAgentDraftAction(props.agent.id, toVersionPayload(form));
        if (!res.ok) {
          toast.error(res.message ?? `${t("Erro")}: ${res.error}`);
          return;
        }
        toast.success(`${t("Rascunho")} v${res.data!.version_number} ${t("salvo.")}`);
        router.refresh();
      } else {
        const payload = {
          name: form.name,
          description: form.description.trim() === "" ? undefined : form.description,
          priority: form.priority,
          version: toVersionPayload(form),
        };
        const validated = agentMcpCreateSchema.safeParse(payload);
        if (!validated.success) {
          toast.error(t("Validação falhou."));
          return;
        }
        const res = await createMcpAgentAction(validated.data);
        if (!res.ok) {
          toast.error(res.message ?? `${t("Erro")}: ${res.error}`);
          return;
        }
        toast.success(t("Agente criado."));
        router.push(`/app/ai/agents/${res.data!.agent_id}`);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    if (!isEdit || !props.draft) return;
    setPublishing(true);
    try {
      const res = await publishAgentAction(props.agent.id, props.draft.id);
      if (!res.ok) {
        toast.error(`${t("Falha ao publicar:")} ${res.error}`);
        return;
      }
      toast.success(`v${props.draft.version_number} ${t("publicada e ativa.")}`);
      setConfirmOpen(false);
      router.refresh();
    } finally {
      setPublishing(false);
    }
  }

  function handleReset() {
    setForm(baseline);
  }

  const disabled = readOnly || saving || publishing;
  const secao: PropsDaSecao = { form, patch, disabled, erros: validation };

  // Status badge
  const statusBadge = (() => {
    if (!isEdit) return <Badge variant="secondary">{t("Novo")}</Badge>;
    const pubN = props.published?.version_number;
    const draftN = props.draft?.version_number;
    if (pubN && draftN) {
      return (
        <Badge variant="secondary">
          {t("Publicado")} v{pubN} + {t("Rascunho")} v{draftN}
        </Badge>
      );
    }
    if (pubN) {
      // O rascunho anterior à publicada não abre nem publica — mas some da tela
      // sem explicação se ninguém o nomear, e aí o autor procura por um trabalho
      // que acha ter perdido. Ele continua no Histórico.
      const obsoleta = props.draftObsoleto?.version_number;
      return (
        <Badge
          variant="default"
          title={
            obsoleta
              ? `${t("O rascunho v")}${obsoleta}${t(" é anterior a esta versão e foi superado por ela — ele continua no Histórico.")}`
              : undefined
          }
        >
          {t("Publicado")} v{pubN}
          {obsoleta ? ` ${t("(rascunho v")}${obsoleta}${t(" superado)")}` : ""}
        </Badge>
      );
    }
    if (draftN) return <Badge variant="outline">{t("Rascunho")} v{draftN}</Badge>;
    // Sem rascunho e sem publicada: o formulário abriu da última versão que
    // existiu (props.base), e não do texto padrão. Dizer isso é o que impede o
    // autor de achar que o prompt sumiu — e de salvar por cima achando que não.
    if (props.base) {
      return (
        <Badge variant="outline">
          {t("Pausado")} {t("· editando a v")}{props.base.version_number}
        </Badge>
      );
    }
    return <Badge variant="outline">{t("Sem versão")}</Badge>;
  })();

  // A ordem é a de quem cria o primeiro agente: quem ele é, o que ele diz, por
  // onde atende e com qual inteligência — o resto tem padrão que serve.
  const indice = [
    { id: "quem", rotulo: t("Quem é") },
    { id: "instrucoes", rotulo: t("Instruções") },
    { id: "numero", rotulo: t("Número") },
    { id: "inteligencia", rotulo: t("Inteligência") },
    { id: "capacidades", rotulo: t("Capacidades") },
    { id: "estilo", rotulo: t("Estilo de resposta") },
    { id: "gatilho", rotulo: t("Quando atende") },
    { id: "pessoa", rotulo: t("Passar para uma pessoa") },
    { id: "followup", rotulo: t("Follow-up") },
    { id: "avancado", rotulo: t("Ajustes avançados") },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight">
              {isEdit ? props.agent.name : t("Novo agente")}
            </h2>
            {statusBadge}
          </div>
          {isEdit && props.agent.description ? (
            <p className="text-xs text-muted-foreground">{props.agent.description}</p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isEdit ? (
            <Button variant="outline" onClick={handleReset} disabled={!dirty || disabled}>
              {t("Descartar alterações")}
            </Button>
          ) : null}
          <Button onClick={handleSave} disabled={(!dirty && isEdit) || disabled || !isValid}>
            {saving ? t("Salvando…") : isEdit ? t("Salvar rascunho") : t("Criar agente")}
          </Button>
          {isEdit ? (
            <span title={publishBlockReason ?? undefined}>
              <Button
                variant="default"
                onClick={() => setConfirmOpen(true)}
                disabled={disabled || publishBlockReason !== null}
              >
                {publishing
                  ? t("Publicando…")
                  : props.draft
                    ? `${t("Publicar v")}${props.draft.version_number}`
                    : t("Publicar")}
              </Button>
            </span>
          ) : null}
        </div>
      </div>

      {/*
        NAVEGAÇÃO POR PAPEL (spec 16 §6). Um form só, um save só — os papéis são
        SEÇÕES, não telas separadas: separá-las em abas com save próprio faria o
        usuário publicar metade da configuração e criaria dois caminhos para o
        mesmo `ai_agent_versions`.

        Os rótulos dizem o que cada papel FAZ. "Conversador"/"Operador" é o nosso
        vocabulário interno; quem configura pensa em "quem fala com meu cliente" e
        "quem organiza minha casa". O terceiro — "Segurança" no nosso nome — diz
        o que é conferido antes de a mensagem chegar ao cliente.
      */}
      <Segmentado<Papel>
        valor={papel}
        aoMudar={setPapel}
        rotuloAcessivel={t("Papéis do agente")}
        className="self-start"
        opcoes={[
          { valor: "conversa", rotulo: t("Conversa com o cliente"), testid: "papel-conversa" },
          { valor: "operacao", rotulo: t("Organiza o sistema"), testid: "papel-operacao" },
          { valor: "seguranca", rotulo: t("Confere antes de enviar"), testid: "papel-seguranca" },
        ]}
      />

      {papel === "seguranca" ? <PainelDeSeguranca /> : null}

      {papel === "operacao" ? (
        <PainelDoOperador
          enabled={form.operator_enabled}
          onEnabledChange={(v) => patch({ operator_enabled: v })}
          model={form.operator_model}
          onModelChange={(v) => patch({ operator_model: v })}
          provider={form.provider}
          toolIds={form.operator_tool_ids}
          onToolIdsChange={(ids) => patch({ operator_tool_ids: ids })}
          modeloDoConversador={form.model}
          disabled={disabled}
        />
      ) : null}

      {/* Fica na aba de OPERAÇÃO e não na de conversa: é permissão de mexer em
          negócio, não de falar com cliente — a mesma separação que a spec 16
          impôs no resto da tela. */}
      {papel === "operacao" ? (
        <FunisDoAgente
          funis={funis}
          cobertura={props.cobertura}
          value={form.pipeline_ids}
          onChange={(ids) => patch({ pipeline_ids: ids })}
          disabled={disabled}
        />
      ) : null}

      {/* Escondido com `hidden`, e não desmontado: os seletores de modelo e de
          capacidades carregam dados ao montar, e trocar de papel não deve
          refazer a busca nem perder a rolagem. */}
      <div
        className={papel === "conversa" ? "grid gap-6 lg:grid-cols-[11rem_minmax(0,1fr)]" : "hidden"}
        data-testid="editor-conversa"
      >
        <NavegacaoDeSecoes
          itens={indice}
          rotuloAcessivel={t("Seções do agente")}
          aoEscolher={(id) => {
            if (id === "avancado") setAvancadoAberto(true);
          }}
        />

        <div className="min-w-0 max-w-3xl space-y-6">
          <AncoraDaSecao id="quem">
            <SecaoIdentidade {...secao} />
          </AncoraDaSecao>
          <AncoraDaSecao id="instrucoes">
            <SecaoInstrucoes {...secao} janelaDeContexto={modelMeta?.context_window ?? null} />
          </AncoraDaSecao>
          <AncoraDaSecao id="numero">
            <SecaoNumero {...secao} numeros={props.channelSessions} roteador={props.routerMembership ?? null} />
          </AncoraDaSecao>
          <AncoraDaSecao id="inteligencia">
            <SecaoInteligencia
              {...secao}
              credenciais={props.credentials}
              instalacaoTemChave={(props.provedoresDaInstalacao ?? []).includes(form.provider)}
              estadoDaCredencial={credSt}
            />
          </AncoraDaSecao>
          <AncoraDaSecao id="capacidades">
            <SecaoCapacidades
              {...secao}
              materiais={props.materiais ?? []}
              integracoes={props.integracoes ?? []}
              emailConfigurado={props.emailConfigurado ?? false}
            />
          </AncoraDaSecao>
          <AncoraDaSecao id="estilo">
            <SecaoEstilo {...secao} servicoDeVoz={props.servicoDeVoz ?? null} />
          </AncoraDaSecao>
          <AncoraDaSecao id="gatilho">
            <SecaoGatilho {...secao} roteador={props.routerMembership ?? null} />
          </AncoraDaSecao>
          <AncoraDaSecao id="pessoa">
            <SecaoPessoa {...secao} />
          </AncoraDaSecao>
          <AncoraDaSecao id="followup">
            <SecaoFollowup {...secao} />
          </AncoraDaSecao>

          <AncoraDaSecao id="avancado">
            <button
              type="button"
              onClick={() => setAvancadoAberto((v) => !v)}
              aria-expanded={mostrarAvancado}
              data-testid="editor-avancado"
              className="ios-grupo flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium"
            >
              <span>
                {t("Ajustes avançados")}
                <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                  {t("Ordem entre agentes, freios por atendimento e quanto da conversa ele relê.")}
                </span>
              </span>
              <CaretDown
                size={14}
                aria-hidden
                className={mostrarAvancado ? "rotate-180 text-muted-foreground transition-transform" : "text-muted-foreground transition-transform"}
              />
            </button>
            {mostrarAvancado ? (
              <SecaoAvancada {...secao} agentId={isEdit ? props.agent.id : null} />
            ) : null}
          </AncoraDaSecao>
        </div>
      </div>

      {/* Publish dialog */}
      {isEdit && props.draft ? (
        <PublishConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          draft={props.draft}
          published={props.published}
          onConfirm={handlePublish}
          isPending={publishing}
        />
      ) : null}
    </div>
  );
}
