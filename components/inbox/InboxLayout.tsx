"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/hooks/i18n/useT";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useBuscarAvatarDoContato } from "@/hooks/inbox/useBuscarAvatarDoContato";
import { estadoDaJanela, formatarDecorrido } from "@/lib/channels/janela";
import { useChannelSessions } from "@/hooks/channels/useChannelSessions";
import { JanelaFechadaAviso } from "@/components/inbox/JanelaFechadaAviso";
import { useClaimConversation } from "@/hooks/inbox/useClaimConversation";
import { useCloseConversation } from "@/hooks/inbox/useCloseConversation";
import { useMarkAsRead } from "@/hooks/inbox/useMarkAsRead";
import {
  useConversationsRealtime,
  type ConversationsFilters,
  type ConversationWithContact,
} from "@/hooks/inbox/useConversationsRealtime";
import { useConversation, isNotFound } from "@/hooks/inbox/useConversation";
import { ConversationList } from "./ConversationList";
import { InboxFilters, type InboxFiltersValue, type InboxTab } from "./InboxFilters";
import { ChatThread } from "./ChatThread";
import { Composer, type ComposerHandle } from "./Composer";
import { ConversationHeader } from "./ConversationHeader";
import { RetentionNotice } from "./RetentionNotice";
import { CRMSidePanel } from "./CRMSidePanel";
import type { Message as ConversationMensagem } from "@/lib/types/messaging";
import { InboxKeyboardShortcuts } from "./InboxKeyboardShortcuts";
import { CONVERSATION_QUEUE_STATUSES } from "@/lib/schemas";

import { ShortcutsHelpDialog } from "./ShortcutsHelpDialog";
import { OpenConversationProvider } from "@/hooks/notifications/OpenConversationContext";
// ADR-05: ícone de feature sai do mapa canônico, nunca do pacote direto.
import { ArrowLeft, ChatCircleText } from "@/lib/ui/icons";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * QUAL COLUNA APARECE NO CELULAR — as duas saem da MESMA pergunta.
 *
 * Abaixo do `md` só cabe uma coluna por vez, então a lista e a conversa se
 * alternam. O defeito que esta função existe para tornar impossível é as duas
 * decidirem por dados DIFERENTES: a lista somia com `selectedId` (o id) e a
 * conversa aparecia com `selectedConversation` (o objeto já carregado). Entre
 * uma coisa e a outra existe uma janela em que nenhuma das duas aparece — e
 * essa janela tem dois casos reais no telefone:
 *
 *   1. o deep-link `/inbox/<id>`, enquanto a busca única ainda responde;
 *   2. a conversa fora do acesso, que é estado PERMANENTE — e cuja mensagem
 *      ("Conversa não encontrada") ficava escondida junto, deixando o dono
 *      numa tela branca sem nem o botão de voltar.
 *
 * Com uma pergunta só, "as duas escondidas" deixa de ser representável.
 * `md:flex` em ambas: no desktop as duas colunas convivem e a regra não vale.
 */
export function colunasDoCelular(temSelecao: boolean): { lista: string; conversa: string } {
  return {
    lista: temSelecao ? "hidden md:flex" : "flex",
    conversa: temSelecao ? "flex" : "hidden md:flex",
  };
}

/**
 * O QUE CADA ABA SIGNIFICA. Exportada porque é a definição em si — o defeito
 * que este mapa já teve (Minhas mostrando tudo que o atendente fechou) não
 * aparece em nenhuma tela até alguém reclamar, então vale prender por teste.
 */
export function tabToFilter(tab: InboxFiltersValue["tab"]): Partial<ConversationsFilters> {
  switch (tab) {
    case "unassigned":
      // Os DOIS estados de espera, não só `open`. A conversa que o automático
      // escalou é `pending` e não aparecia em aba nenhuma que o atendente vê —
      // "Fila" pedia `open`, "Minhas" exige dono, "IA" filtra `ai_handling` e
      // "Todas" é escondida do papel `agent` fora do modo `all`. A conversa que
      // mais precisa de uma pessoa era a única invisível.
      return { assigned_to: "unassigned", status: [...CONVERSATION_QUEUE_STATUSES] };
    case "mine":
      // Sem `exclude_finished` a aba mostra tudo que o atendente JÁ atendeu —
      // `Fechar` muda o status mas não solta o dono (de propósito: quem atendeu
      // é histórico). O lugar de "minhas fechadas" é a aba Fechadas.
      return { assigned_to: "me", exclude_finished: true };
    case "closed":
      return { status: "closed" };
    case "ai":
      return { status: "ai_handling" };
    case "all":
    default:
      return {};
  }
}

const FILTER_TABS: InboxTab[] = ["unassigned", "mine", "all", "closed", "ai"];

/**
 * Lê ?filter= (G4-02, deep-link). ?filter=all é HONRADO mesmo para agent — a
 * lista volta RLS-scoped (a tab só some cosmeticamente); default: fila.
 */
function parseFilterParam(v: string | null): InboxTab {
  return v && FILTER_TABS.includes(v as InboxTab) ? (v as InboxTab) : "unassigned";
}

interface InboxLayoutProps {
  initialSelectedId?: string | null;
}

export function InboxLayout({ initialSelectedId = null }: InboxLayoutProps = {}) {
  const t = useT();
  const { activeOrg } = useAuth();
  const orgId = activeOrg?.orgId ?? null;

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = parseFilterParam(searchParams.get("filter"));

  // tab vive na URL (?filter=); os demais filtros são estado local de sessão.
  const [aux, setAux] = useState<Omit<InboxFiltersValue, "tab">>({
    search: "",
    onlyUnread: false,
  });
  const filterValue: InboxFiltersValue = { tab, ...aux };
  const setFilterValue = useCallback(
    (next: InboxFiltersValue) => {
      if (next.tab !== tab) {
        const params = new URLSearchParams(searchParams);
        params.set("filter", next.tab);
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      }
      const { tab: _t, ...rest } = next;
      setAux(rest);
    },
    [tab, searchParams, router, pathname],
  );

  /**
   * A CONVERSA ABERTA VIVE NA URL (`?id=`), e o estado local só a espelha.
   *
   * Antes só o `?id=` da PRIMEIRA carga contava; depois era estado local. Dois
   * defeitos saíam daí, os dois no telefone:
   *
   *   1. o voltar do Android (e o gesto de voltar do iPhone) SAÍA do inbox em
   *      vez de devolver a lista — não havia entrada de histórico para desfazer;
   *   2. o toque numa notificação (`router.push('/app/inbox?id=X')`) com o
   *      inbox já aberto mudava a URL e não abria conversa nenhuma.
   *
   * Agora: URL → estado no efeito abaixo; estado → URL em `handleSelect`, com
   * `history.pushState` (o Next sincroniza `useSearchParams` com ele, sem ida ao
   * servidor). Abrir a partir da lista EMPILHA uma entrada, para o voltar do
   * aparelho cair na lista; trocar de uma conversa para outra SUBSTITUI, para o
   * histórico não virar uma pilha de conversas.
   */
  const idNaUrl = searchParams.get("id");
  const [selectedId, setSelectedId] = useState<string | null>(idNaUrl ?? initialSelectedId);
  const ultimoIdDaUrl = useRef<string | null>(idNaUrl);
  /** A conversa aberta entrou por um toque na lista (há entrada de histórico a desfazer). */
  const abriuPelaLista = useRef(false);
  const [visibleIds, setVisibleIds] = useState<string[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  /** A ficha do contato como painel deslizante — só existe abaixo do `xl`. */
  const [fichaAberta, setFichaAberta] = useState(false);
  /**
   * "Dados do contato" como no WhatsApp: FECHADO por padrão, e abre só quando
   * se clica no cabeçalho da conversa. Aberto sempre, ele comia 300px da
   * conversa em toda tela — e é consulta, não o lugar onde se trabalha.
   * Em tela larga (≥1536px) vira terceira coluna; abaixo disso abre por cima
   * (Sheet) — medido: em 1280 a coluna apertava a conversa a ~300px.
   */
  const [perfilAberto, setPerfilAberto] = useState(false);
  const abrirPerfil = useCallback(() => {
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 1536px)").matches) {
      setPerfilAberto((v) => !v);
    } else {
      setFichaAberta(true);
    }
  }, []);
  /**
   * A mensagem escolhida para responder "em cima".
   *
   * Mora aqui, e não no composer, porque quem ESCOLHE é a lista de mensagens e
   * quem MOSTRA é o composer — são irmãos, e o estado comum é do pai.
   */
  const [respondendo, setRespondendo] = useState<ConversationMensagem | null>(null);
  const composerRef = useRef<ComposerHandle | null>(null);

  const filters: ConversationsFilters = useMemo(
    () => ({
      ...tabToFilter(filterValue.tab),
      search: filterValue.search || undefined,
      channel_session_id: filterValue.channel_session_id,
      tag: filterValue.tag,
      sort: filterValue.sort,
    }),
    [
      filterValue.tab,
      filterValue.search,
      filterValue.channel_session_id,
      filterValue.tag,
      filterValue.sort,
    ],
  );

  const clientFilter = useMemo(
    () =>
      filterValue.onlyUnread
        ? (c: ConversationWithContact) => (c.unread_count_for_assignee ?? 0) > 0
        : undefined,
    [filterValue.onlyUnread],
  );

  // We need the selected conversation object for header / composer / side panel.
  // Source it from the same query the list uses to avoid an extra request.
  const listQ = useConversationsRealtime(filters, orgId);
  const inList = useMemo(() => {
    const all = listQ.data?.pages.flatMap((p) => p.data) ?? [];
    return all.find((c) => c.id === selectedId) ?? null;
  }, [listQ.data, selectedId]);

  // Deep-link para conversa fora do filtro atual (ou fora do escopo do agent):
  // busca única RLS-scoped. 404/vazio ⇒ inacessível ⇒ estado vazio claro (GAP D),
  // nunca stack trace. A RLS (G4-01) é quem garante o não-vazamento.
  const needsFetch = !!selectedId && !inList && !listQ.isLoading;
  const single = useConversation(selectedId, needsFetch);
  const selectedConversation: ConversationWithContact | null = inList ?? single.data ?? null;
  const selectionNotFound =
    needsFetch && !single.isPending && !single.data && isNotFound(single.error);

  const colunas = colunasDoCelular(Boolean(selectedId));

  const claim = useClaimConversation();
  const close = useCloseConversation();

  // A leitura da conversa aberta é do upstream e fica: sem ela o contador de
  // não-lidas nunca zera para quem abre a conversa.
  useMarkAsRead(
    selectedConversation?.id ?? null,
    selectedConversation?.unread_count_for_assignee ?? 0,
  );

  // URL → estado: o voltar do aparelho/navegador e o link de notificação.
  useEffect(() => {
    if (idNaUrl === ultimoIdDaUrl.current) return;
    ultimoIdDaUrl.current = idNaUrl;
    if (idNaUrl === null) abriuPelaLista.current = false;
    setSelectedId(idNaUrl);
    // Sem isto, a citação escolhida numa conversa iria junto para a outra.
    setRespondendo(null);
  }, [idNaUrl]);

  // Aceita `null`: é o VOLTAR do celular, que limpa a seleção e devolve a lista.
  const handleSelect = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      // Sem isto, escolher "responder" numa conversa e trocar para outra levaria
      // a citação junto — e a resposta sairia citando mensagem de outro cliente.
      setRespondendo(null);
      if (typeof window === "undefined") return;

      const atual = ultimoIdDaUrl.current;
      ultimoIdDaUrl.current = id;
      if (id === null && abriuPelaLista.current) {
        // Desfaz a entrada que o toque na lista empilhou: o histórico fica
        // como estava antes de abrir, e o voltar do aparelho não "reabre" nada.
        abriuPelaLista.current = false;
        window.history.back();
        return;
      }
      const params = new URLSearchParams(window.location.search);
      if (id) params.set("id", id);
      else params.delete("id");
      const qs = params.toString();
      const url = `${pathname}${qs ? `?${qs}` : ""}`;
      if (id !== null && atual === null) {
        abriuPelaLista.current = true;
        window.history.pushState(null, "", url);
      } else {
        window.history.replaceState(null, "", url);
      }
    },
    [pathname],
  );
  const handleVisibleChange = useCallback((ids: string[]) => setVisibleIds(ids), []);
  const handleFocusReply = useCallback(() => composerRef.current?.focus(), []);
  const handleClaim = useCallback(() => {
    if (!selectedConversation) return;
    claim.mutate({
      conversation_id: selectedConversation.id,
      expected_assignee: selectedConversation.assigned_to_user_id,
    });
  }, [claim, selectedConversation]);
  const handleClose = useCallback(() => {
    if (!selectedConversation) return;
    close.mutate({ conversation_id: selectedConversation.id });
  }, [close, selectedConversation]);

  // A janela vence SOZINHA com a aba aberta. Sem este relógio, quem deixa o
  // inbox aberto a tarde inteira seguiria com o composer liberado numa conversa
  // que já venceu — e o bloqueio só apareceria no próximo recarregamento.
  const [agoraJanela, setAgoraJanela] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setAgoraJanela(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // A janela de 24h fecha o composer, e o motivo DIZ há quanto tempo fechou.
  //
  // Antes disto o texto livre saía, o CRM marcava `failed` e o operador via um
  // `131047` — descobrindo a regra pelo erro, uma mensagem por vez. Barrar aqui
  // é o pedido explícito do dono: se não dá para enviar, que não deixe tentar.
  //
  // Reusa o `blockedReason` que já existe (contato bloqueado/anonimizado) em vez
  // de um segundo mecanismo de bloqueio: dois caminhos para desabilitar o mesmo
  // composer divergem, e o segundo esquece de cobrir o áudio ou o anexo.
  // A foto do contato da conversa ABERTA, quando ele nunca teve uma buscada.
  // Uma por vez e uma vez só — ver o cabeçalho do hook.
  useBuscarAvatarDoContato(selectedConversation?.contacts ?? null);

  /**
   * A MODALIDADE do canal desta conversa — o que decide se há janela de 24h num
   * provider que hospeda instância oficial e número por QR na mesma conta.
   *
   * Vem da lista de canais e NÃO do embed da conversa, e a razão é de robustez:
   * o `select` de `conversations` é compartilhado por quatro handlers e não tem
   * camada de tolerância a coluna ausente, então uma coluna da migration 0206
   * ali faria a listagem inteira do inbox falhar (42703) num clone atrasado —
   * trocaria um relógio por uma tela em branco. `useChannelSessions` é tolerante
   * de propósito, e o `id` do embed é o que permite casar as duas pontas.
   */
  const canaisDaOrg = useChannelSessions().data;
  const modoDoCanal =
    canaisDaOrg?.find((c) => c.id === selectedConversation?.channel_sessions?.id)?.provider_mode ??
    null;

  const janela = estadoDaJanela(
    selectedConversation?.channel_sessions?.provider ?? null,
    selectedConversation?.last_inbound_at ?? null,
    agoraJanela,
    modoDoCanal,
  );
  const motivoDaJanela =
    janela.tipo === "fechada"
      ? janela.fechadaHaMs === null
        ? t("O cliente ainda não escreveu — a janela de 24h nunca abriu. Só um modelo aprovado sai daqui.")
        : `${t("A janela de 24h fechou há")} ${formatarDecorrido(janela.fechadaHaMs)}. ${t("Só um modelo aprovado sai daqui — texto livre é recusado pela plataforma.")}`
      : null;

  const blockedReason = selectedConversation?.contacts?.is_blocked
    ? t("Contato bloqueado — envio de mensagens desabilitado.")
    : selectedConversation?.contacts?.is_anonymized
      ? t("Contato anonimizado — não é possível enviar mensagens.")
      : null;

  // ⚠️ A ALTURA DEIXOU DE SER CALCULADA, e o parágrafo que sai daqui vale a
  // lápide. Ele dizia:
  //
  //     h-[calc(100dvh - 3.5rem - 2*var(--space-6))]
  //     3.5rem         cabeçalho (h-14)
  //     2*--space-6    padding do <main> do AppShell (p-6, em cima e embaixo)
  //
  // Estava certo, era bem explicado, e mesmo assim quebrou — porque era uma soma
  // escrita à mão AQUI sobre valores que moram LÁ, sem nada ligando os dois. O
  // redesenho da navegação trocou o `p-6` uniforme por `py-5` abaixo de `lg`, e
  // esta conta passou a medir 8px A MAIS que o espaço real. Quem pagava era o
  // composer, no rodapé: nascia parcialmente fora da tela, justo na hora de
  // escrever — o mesmo sintoma que a conta existia para evitar.
  //
  // Hoje o `AppShell` é `h-dvh` + `overflow-hidden`, a coluna dele é `min-h-0` e
  // o `<main>` é `flex-1`: "o que sobrou" é uma medida do LAYOUT, não uma soma
  // que alguém precisa lembrar de atualizar. Aqui só se pede `h-full`.
  //
  // E no Inbox o `<main>` não tem padding nenhum (`lib/navigation/casca.ts`), o
  // que é o que faz a conversa ir de borda a borda.

  // TRÊS COLUNAS QUE CABEM — medido, não estimado.
  //
  // O `xl` do Tailwind dispara em 1280px, e era ali que a terceira coluna
  // nascia: no ponto exato em que não havia espaço para ela. Com a barra de
  // navegação (240px) sobram 1040px, e o grid pedia 300 + 707 + 320 = 1327 —
  // o painel de CRM ficava 311px FORA da viewport, alcançável só rolando o
  // `main` de lado, que ninguém faz. Em 1280 o atendente simplesmente não via
  // contexto nenhum do cliente.
  //
  // Os 707px eram o `min-content` do `ConversationHeader` (a barra de ações
  // era `shrink-0`), e `1fr` é `minmax(auto, 1fr)`: não encolhe abaixo disso.
  // Consertado o header, o `1fr` volta a encolher sozinho — `minmax(0,1fr)`
  // foi medido aqui e não mudou um pixel, então não entrou.
  //
  // Duas faixas em vez de uma: compacta onde aperta, generosa onde há espaço.
  // Em 1280 isso dá 424px de conversa em vez de 372 — 54px de folga sobre o
  // piso do composer (370px), em vez dos 2px que a versão de uma faixa só
  // deixava. Margem de 2px não é margem, é sorte.
  return (
    <OpenConversationProvider conversationId={selectedId}>
    <div
      // `minmax(0, 1fr)` e a linha `minmax(0, 1fr)`, NUNCA `1fr` puro: `1fr` é
      // `minmax(auto, 1fr)`, e o `auto` deixa o CONTEÚDO ditar o tamanho. Medido
      // em produção: um link comprido numa mensagem esticava a coluna da
      // conversa para fora da tela (a lista aparecia cortada à esquerda e o
      // painel sumia à direita), e o painel de contato alto empurrava a página
      // para baixo, deixando meia tela em branco.
      className={cn(
        "relative grid h-full w-full grid-cols-1 grid-rows-[minmax(0,1fr)] overflow-hidden md:grid-cols-[340px_minmax(0,1fr)] 2xl:grid-cols-[400px_minmax(0,1fr)]",
        perfilAberto &&
          selectedConversation &&
          "2xl:grid-cols-[400px_minmax(0,1fr)_400px]",
      )}
      /*
       * O ESTADO DO TEMPO REAL, LEGÍVEL DE FORA — mesmo par que o dossiê do lead
       * já publica (`LeadDossier`), e pela mesma razão: quando a entrega morre,
       * nenhuma tela avisa. Foi o único achado que atravessou o dia intacto
       * quando o realtime quebrou pela primeira vez, e voltou a morder agora.
       *
       * `divergencias` é o que a rede de segurança contou: refetch trouxe estado
       * novo que o canal NÃO tinha entregue. Zero com o canal vivo; subindo é a
       * assinatura de canal que assina e não entrega — o defeito que não grita.
       *
       * ⚠️ `data-realtime-status` vem do STATUS do canal, não de um objeto que
       * existe sempre. A primeira versão desta linha derivava o valor de
       * `listQ.seguranca`, que nunca é nulo — ela diria `ativo` inclusive com o
       * canal morto. Controle decorativo é pior que controle nenhum: mente com
       * cara de instrumento.
       *
       * Atributo de dado e não texto na tela de propósito: quem lê isto é o
       * teste e quem depura, não o atendente. Pôr um aviso permanente na cara de
       * quem atende seria ruído; esconder o sinal do todo é o que custou o dia.
       */
      data-realtime-status={listQ.realtimeStatus}
      data-refetch-divergencias={listQ.seguranca?.divergencias ?? 0}
    >
      {/*
        NO CELULAR, UMA COISA POR VEZ.

        Antes as duas colunas caíam empilhadas em `grid-cols-1`: a lista inteira
        primeiro e a conversa DEPOIS dela. Para responder era preciso rolar a
        lista toda até o fim, e o composer ficava fora da tela — que é o
        "incômodo" relatado por quem atende do telefone.

        Sem media query em JavaScript de propósito: `useMediaQuery` decide DEPOIS
        da hidratação, então a primeira pintura mostra o layout errado e pisca. A
        classe condicional é resolvida pelo CSS, na primeira pintura, e some no
        `md` — onde as duas colunas cabem juntas e a regra não se aplica.
      */}
      <div
        className={cn(
          "h-full min-h-0 flex-col border-r border-border md:flex",
          colunas.lista,
        )}
      >
        {/* O topo da lista no celular, no lugar do cabeçalho do app (que some
            no Inbox): o título, como no WhatsApp. A navegação está na barra
            de abas embaixo. */}
        <div className="flex h-14 shrink-0 items-center bg-background px-4 md:hidden">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{t("Conversas")}</h1>
        </div>
        <InboxFilters value={filterValue} onChange={setFilterValue} />
        <div className="min-h-0 flex-1 overflow-hidden">
          <ConversationList
            listQuery={listQ}
            filters={filters}
            selectedId={selectedId}
            onSelect={handleSelect}
            clientFilter={clientFilter}
            onVisibleChange={handleVisibleChange}
          />
        </div>
      </div>

      {/*
        AS DUAS COLUNAS DECIDEM PELO MESMO DADO — `selectedId`, não o objeto.

        A da lista some quando há `selectedId`; se esta aparecesse só quando a
        conversa já está CARREGADA, a janela entre as duas coisas não mostra
        nenhuma das colunas. No celular isso é a tela em branco, e ela tem dois
        casos reais: o instante do deep-link `/inbox/<id>`, enquanto a busca
        única ainda responde; e o estado permanente de conversa fora do acesso,
        cuja mensagem ("Conversa não encontrada") é justamente o que ficava
        escondido — deixando o dono numa tela vazia, sem sequer o botão de
        voltar, porque ele morava dentro do ramo da conversa carregada.
      */}
      <div
        className={cn(
          "h-full min-h-0 flex-col md:flex",
          colunas.conversa,
        )}
      >
        {/*
          O ← do celular mora DENTRO do cabeçalho da conversa (uma linha só, como
          no WhatsApp). Enquanto a conversa não carregou — ou quando ela está
          fora do acesso, que é estado permanente — não há cabeçalho, e esta
          barra mínima é a única saída. Nunca as duas ao mesmo tempo.
        */}
        {selectedId && !selectedConversation && (
          <div className="flex min-h-14 items-center border-b border-border px-1 md:hidden">
            <Button
              variant="ghost"
              size="icon"
              className="size-10 rounded-full"
              aria-label={t("Voltar para as conversas")}
              data-testid="voltar-para-conversas"
              onClick={() => handleSelect(null)}
            >
              <ArrowLeft size={22} aria-hidden />
            </Button>
          </div>
        )}
        {/* A ficha do contato por cima (abaixo de 1536px). Controlada: quem abre
            é o toque no nome ou o item "Dados do contato" do ⋮. */}
        {selectedConversation && (
          <Sheet open={fichaAberta} onOpenChange={setFichaAberta}>
            <SheetContent side="right" className="w-[min(26rem,100vw)] overflow-y-auto p-0">
              <SheetTitle className="sr-only">{t("Ficha do contato")}</SheetTitle>
              <CRMSidePanel conversation={selectedConversation} onFechar={() => setFichaAberta(false)} />
            </SheetContent>
          </Sheet>
        )}
        {selectedConversation ? (
          <>
            <ConversationHeader
              conversation={selectedConversation}
              onAbrirPerfil={abrirPerfil}
              onIrParaAba={(aba) => setFilterValue({ ...filterValue, tab: aba })}
              onVoltar={() => handleSelect(null)}
            />
            <div className="min-h-0 flex-1 overflow-hidden">
              <ChatThread
                conversationId={selectedConversation.id}
                onResponder={setRespondendo}
                canalDaConversa={selectedConversation.channel_sessions ?? null}
              />
            </div>
            <RetentionNotice conversationId={selectedConversation.id} />
            {motivoDaJanela && (
              <JanelaFechadaAviso
                conversationId={selectedConversation.id}
                provider={selectedConversation.channel_sessions?.provider ?? null}
                // A MESMA modalidade que decidiu barrar o texto livre logo
                // acima. Sem ela, o canal intermediado oficial barrava e não
                // oferecia modelo nenhum — o operador ficava sem caminho, que é
                // o que este aviso existe para não deixar acontecer.
                modo={modoDoCanal}
                canalId={selectedConversation.channel_sessions?.id ?? null}
                motivo={motivoDaJanela}
              />
            )}
            <Composer
              ref={composerRef}
              conversationId={selectedConversation.id}
              blockedReason={blockedReason}
              janelaFechada={motivoDaJanela}
              disabled={selectedConversation.status === "closed"}
              contactName={selectedConversation.contacts?.name ?? null}
              respondendo={respondendo}
              onCancelarResposta={() => setRespondendo(null)}
              currentContactId={selectedConversation.contact_id}
            />
          </>
        ) : selectionNotFound ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
            {t("Conversa não encontrada ou fora do seu acesso.")}
          </div>
        ) : (
          // O vazio também é chão de conversa — com a textura, e dizendo o que
          // fazer, em vez de uma frase solta num branco.
          <div className="inbox-papel flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <span className="flex size-16 items-center justify-center rounded-full bg-background shadow-sm">
              <ChatCircleText size={30} weight="duotone" className="text-accent" aria-hidden />
            </span>
            <p className="text-lg font-medium text-foreground">{t("Selecione uma conversa")}</p>
            <p className="max-w-xs text-sm text-muted-foreground">
              {t("Escolha uma conversa na lista ao lado para ver as mensagens e responder.")}
            </p>
          </div>
        )}
      </div>

      {perfilAberto && selectedConversation && (
        <div className="perfil-entra hidden h-full min-h-0 2xl:block">
          <CRMSidePanel conversation={selectedConversation} onFechar={() => setPerfilAberto(false)} />
        </div>
      )}
      <InboxKeyboardShortcuts
        visibleIds={visibleIds}
        selectedId={selectedId}
        onSelect={handleSelect}
        onFocusReply={handleFocusReply}
        onClaim={handleClaim}
        onClose={handleClose}
        onToggleHelp={() => setHelpOpen((v) => !v)}
      />
      <ShortcutsHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
    </OpenConversationProvider>
  );
}
