"use client";
import { useState } from "react";
import { useT } from "@/hooks/i18n/useT";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AvatarDoContato } from "@/components/inbox/AvatarDoContato";
import { TipoDeCanal } from "@/components/channels/TipoDeCanal";
import { Badge } from "@/components/ui/badge";
import { JanelaSelo } from "@/components/inbox/JanelaSelo";
import { useChannelSessions } from "@/hooks/channels/useChannelSessions";
import {
  ArrowBendUpLeft,
  CalendarPlus,
  Clock,
  DotsThreeVertical,
  FilePdf,
  FileXls,
  FlowArrow,
  Pause,
  Robot,
  UserCircle,
  UsersThree,
  X,
} from "@/lib/ui/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSnoozeConversation } from "@/hooks/inbox/useSnoozeConversation";
import { AtivarFluxoDialog } from "@/components/inbox/AtivarFluxoDialog";
import { AgendarMensagemDialog } from "@/components/inbox/AgendarMensagemDialog";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useClaimConversation } from "@/hooks/inbox/useClaimConversation";
import { useReleaseConversation } from "@/hooks/inbox/useReleaseConversation";
import { useCloseConversation } from "@/hooks/inbox/useCloseConversation";
import { useResumeAiAttendance } from "@/hooks/inbox/useResumeAiAttendance";
import { usePauseAiAttendance } from "@/hooks/inbox/usePauseAiAttendance";
import { useAutomaticoAtivo } from "@/hooks/ai/useAutomaticoAtivo";
import { OwnerBadge } from "@/components/kanban/OwnerBadge";
import { comandoDaConversa, ROTULO_DO_MOTIVO } from "@/lib/inbox/comando-da-conversa";
import { ReassignDialog } from "@/components/inbox/ReassignDialog";
import type { ConversationWithContact } from "@/hooks/inbox/useConversationsRealtime";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";
import { phoneForDisplay } from "@/lib/channels/phone-variants";

interface Props {
  conversation: ConversationWithContact;
  /** Clicar no rosto/nome abre "Dados do contato" — como no WhatsApp. */
  onAbrirPerfil?: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  open: "Aberta",
  // É EXATAMENTE o estado em que a passagem para humano deixa a conversa
  // (`performHumanHandoff`: 'ai_handling' → 'pending'), e o rótulo faltava — toda
  // conversa escalada mostrava `pending` cru no rosto do atendente. O
  // `conversationStatusSchema` não lista 'pending' porque valida ENTRADA da API;
  // quem escreve este estado é o motor, e a tela precisa saber lê-lo.
  pending: "Aguardando atendente",
  claimed: "Em atendimento",
  // "Automático", não "IA": com o selo de comando ao lado dizendo quem manda, o
  // header mostrava DUAS palavras para o MESMO ator na mesma linha ("IA
  // atendendo" + "Automático"). A palavra do estado já é contrato em quatro
  // arquivos e no dicionário; a que sobrava era esta.
  ai_handling: "Automático atendendo",
  closed: "Fechada",
  archived: "Arquivada",
};

/** Fora do componente: o relógio é lido no momento do desenho, não é estado. */
function lembreteVigente(snoozeUntil: string | null): boolean {
  return snoozeUntil != null && new Date(snoozeUntil).getTime() > Date.now();
}

export function ConversationHeader({ conversation, onAbrirPerfil }: Props) {
  const t = useT();
  const { user } = useAuth();
  const claim = useClaimConversation();
  const release = useReleaseConversation();
  const close = useCloseConversation();
  const retomar = useResumeAiAttendance();
  const pausar = usePauseAiAttendance();
  const snooze = useSnoozeConversation();
  // "Existe automático nesta org?" — sem isto o selo afirmava que o robô estava
  // atendendo em instalação que nunca configurou agente nenhum.
  const automaticoDaOrg = useAutomaticoAtivo();
  const [reassignOpen, setReassignOpen] = useState(false);
  const [ativarFluxoOpen, setAtivarFluxoOpen] = useState(false);
  const [agendarOpen, setAgendarOpen] = useState(false);

  const c = conversation.contacts ?? null;
  const displayName = rotuloDoContato(c);
  const phone = c?.phone_number ? phoneForDisplay(c.phone_number) : null;
  // O canal por onde a conversa entrou. Cai no nome quando não há número (canal
  // recém-criado ainda não sabe o próprio telefone), e some quando não há
  // nenhum dos dois — linha "por" vazia seria pior que linha nenhuma.
  const canal = conversation.channel_sessions ?? null;
  const rotuloDoCanal = canal?.phone_number ?? canal?.display_name ?? null;
  // A MODALIDADE vem da lista de canais, não do embed da conversa: o `select` de
  // `conversations` é compartilhado e sem tolerância a coluna ausente, então uma
  // coluna da 0206 ali derrubaria a listagem num clone atrasado. A query abaixo
  // já está em cache (o seletor de números e o sinal de saúde a compartilham).
  const modoDoCanal =
    useChannelSessions().data?.find((c) => c.id === canal?.id)?.provider_mode ?? null;
  const status = conversation.status;
  const isMineAssigned = conversation.assigned_to_user_id === user.id;
  const isOpen = status === "open" || conversation.assigned_to_user_id == null;

  /**
   * QUEM MANDA, uma pergunta com uma resposta.
   *
   * Este bloco era três leituras parciais. O selo e o botão de volta liam duas
   * travas (`bot_silenced_until || force_human`); a linha da lista lia uma, por
   * COR; o painel não lia nenhuma. Desde a 0173 há uma quarta situação —
   * "alguém assumiu" — e continuar somando condições à mão aqui é como as três
   * leituras divergiram em primeiro lugar. A regra mora em `lib/inbox`,
   * espelhando os gates que o MOTOR lê, e esta tela só a consome.
   */
  const { comando, automaticoAtivo, travaVigente, motivo } = comandoDaConversa({
    status,
    assigned_to_user_id: conversation.assigned_to_user_id,
    assigned_to_user_name: conversation.assigned_to_user_name ?? null,
    assignee_kind: conversation.assignee_kind ?? null,
    bot_silenced_until: conversation.bot_silenced_until ?? null,
    force_human: c?.force_human ?? null,
    automaticoDaOrg: automaticoDaOrg.data,
  });

  const encerrada = status === "closed" || status === "archived";
  /**
   * A VOLTA aparece sempre que há algo a devolver — inclusive em conversa
   * ENCERRADA. Antes ela era condicionada a `status !== "closed"`, e o resultado
   * era um beco sem saída medido: atendente assume, fecha, sai de férias; a
   * conversa fica com o automático parado e, para qualquer colega, sem NENHUMA
   * porta — "Liberar" só existe para o próprio dono e a rota recusa quem não é.
   * `devolverAtendimentoAoAgente` funciona nesse estado (o status fechado está na
   * lista de reativáveis), então esconder o botão escondia uma ação que existe.
   *
   * A condição é `travaVigente`, e NÃO `!automaticoAtivo`: conversa encerrada tem
   * o automático inativo sem ter trava nenhuma, e sair do segundo faria o botão
   * aparecer em toda conversa fechada — clicá-lo REABRIRIA uma conversa que
   * ninguém pediu para reabrir. Oferecer uma ação que não deveria acontecer é
   * pior que não oferecer nenhuma.
   */
  const podeDevolver = travaVigente;
  /**
   * PAUSAR só aparece quando pausar é um gesto DIFERENTE de assumir.
   *
   * Desde a 0173 "Assumir" já cala o automático (a RPC grava o silêncio). Numa
   * conversa sem dono, portanto, "Assumir" e "Pausar o automático" teriam
   * exatamente o mesmo efeito — dois botões para um ato é a confusão que esta
   * entrega existe para acabar, não para dobrar.
   *
   * Sobra o caso em que ele é próprio: a conversa JÁ tem dono e o automático
   * continua de pé. Isso é real e não é raro — o rodízio (`reason='routing'`)
   * distribui sem calar, de propósito, senão uma org em round_robin ficaria sem
   * automático nenhum.
   */
  const podePausar = automaticoAtivo && !encerrada && conversation.assigned_to_user_id !== null;

  const aberta = status !== "closed" && status !== "archived";
  const lembreteAtivo = lembreteVigente(conversation.snooze_until ?? null);
  const exportar = (formato: "pdf" | "xlsx") =>
    `/api/v1/conversations/${conversation.id}/export?formato=${formato}`;

  return (
    // CABEÇALHO DE MENSAGEIRO: rosto, nome e UMA linha de contexto à esquerda;
    // à direita só a ação que a conversa pede AGORA e o ⋮ com o resto.
    //
    // Antes eram até oito botões com texto lado a lado (Assumir, Liberar,
    // Transferir, Lembrar, Fechar, Ver contato…) e quatro selos em cima do nome —
    // a barra quebrava em duas linhas em 1280px e o nome do cliente era a coisa
    // MENOS visível do topo. Nada sumiu: tudo que saiu da barra está no ⋮, e a
    // ação principal continua a um clique.
    //
    // `flex-wrap` e a barra de ações `min-w-0` + `flex-wrap` (sem `shrink-0`)
    // FICAM: é o que impede o header de impor largura mínima à coluna do meio —
    // ver `inbox-header-nao-trava.test.tsx`.
    <div className="inbox-barra border-border/60 flex min-h-[60px] flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b px-4 py-2">
      {/* O rosto e o nome são a PORTA do perfil, como no WhatsApp: um clique abre
          "Dados do contato". `role="button"` num div (e não <button>) porque
          dentro dele há selos com tooltip, e botão dentro de botão é HTML
          inválido. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onAbrirPerfil}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onAbrirPerfil?.();
          }
        }}
        title={t("Dados do contato")}
        data-testid="abrir-perfil-do-contato"
        className="-my-1 -ml-2 flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg py-1 pl-2 transition-colors hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <AvatarDoContato
          contactId={c?.id}
          temFoto={Boolean(c?.avatar_storage_path)}
          anonimizado={c?.is_anonymized}
          nome={displayName}
          className="h-10 w-10 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-medium leading-5 text-foreground">
            {displayName}
          </h2>
          {/* UMA linha de contexto, na ordem em que se pergunta: quem está
              respondendo, qual o número do cliente, por qual número da empresa, e
              se dá para escrever agora. Os selos que decidem ação (janela de 24h,
              automático calado) continuam visíveis — são pequenos, não somem. */}
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden text-xs leading-4 text-muted-foreground">
            <span className="flex shrink-0 items-center" data-testid="comando-da-conversa">
              {comando.quem === "humano" ? (
                <OwnerBadge ownerKind="user" ownerName={comando.nome ?? t("Atendente")} />
              ) : comando.quem === "automatico" ? (
                <OwnerBadge ownerKind="ai" ownerName={t("Automático")} />
              ) : (
                <OwnerBadge ownerKind={null} ownerName={null} />
              )}
            </span>
            {phone && (
              <span className="flex shrink-0 items-center gap-1">
                <span aria-hidden>·</span>
                {phone}
              </span>
            )}
            {rotuloDoCanal && (
              <span
                className="flex shrink-0 items-center gap-1"
                data-testid="canal-da-conversa"
                title={`${t("por")} ${rotuloDoCanal}`}
              >
                <span aria-hidden>·</span>
                {/* O número da empresa por extenso só onde cabe; no aperto fica o
                    selo do tipo, com o número no `title` — cortado em "p." ele
                    não dizia nada. */}
                <span className="hidden 2xl:inline">
                  {t("por")} {rotuloDoCanal}
                </span>
                <TipoDeCanal provider={canal?.provider} variante="linha" />
              </span>
            )}
            <JanelaSelo
              provider={conversation.channel_sessions?.provider ?? null}
              lastInboundAt={conversation.last_inbound_at}
              modo={modoDoCanal}
            />
            {motivo !== null && (
              <Badge
                variant="outline"
                className="h-4 shrink-0 px-1.5 text-[10px]"
                data-testid="badge-atendimento-humano"
              >
                {t(ROTULO_DO_MOTIVO[motivo])}
              </Badge>
            )}
            {!aberta && (
              <Badge variant="outline" className="h-4 shrink-0 px-1.5 text-[10px]">
                {t(STATUS_LABEL[status] ?? status)}
              </Badge>
            )}
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {/* A AÇÃO PRINCIPAL — a que a conversa pede agora. Uma de cada vez: sem
            dono, "Assumir"; com o automático travado, "Devolver ao automático".
            O rótulo e o `data-testid` são contrato das specs de ponta a ponta. */}
        {isOpen ? (
          <Button
            size="sm"
            className="h-9 rounded-full px-4"
            disabled={claim.isPending}
            title={t("Você passa a responder esta conversa e o atendimento automático para aqui.")}
            onClick={() =>
              claim.mutate({
                conversation_id: conversation.id,
                expected_assignee: conversation.assigned_to_user_id,
              })
            }
          >
            {t("Assumir")}
          </Button>
        ) : podeDevolver ? (
          <Button
            size="sm"
            variant="outline"
            className="h-9 rounded-full bg-background px-4"
            disabled={retomar.isPending}
            data-testid="devolver-ao-automatico"
            // O alcance da volta não é sempre o mesmo: quando foi o CLIENTE que
            // travou (`force_human`), o clique religa o automático para todas as
            // conversas dele. Um botão que às vezes faz mais do que o nome promete
            // precisa dizer quando.
            title={
              motivo === "contato_travado"
                ? t(
                    "Religa o atendimento automático para este cliente — vale para todas as conversas dele.",
                  )
                : t("Devolve esta conversa ao atendimento automático.")
            }
            onClick={() => retomar.mutate({ conversation_id: conversation.id })}
          >
            {retomar.isPending ? t("Devolvendo...") : t("Devolver ao automático")}
          </Button>
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="size-10 rounded-full text-muted-foreground hover:text-foreground"
              aria-label={t("Mais ações")}
              data-testid="menu-acoes-conversa"
            >
              <DotsThreeVertical size={22} weight="bold" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            {isMineAssigned && (
              <DropdownMenuItem
                disabled={release.isPending}
                onSelect={() => release.mutate({ conversation_id: conversation.id })}
              >
                <ArrowBendUpLeft size={16} aria-hidden className="mr-2" />
                {t("Liberar")}
              </DropdownMenuItem>
            )}
            {isOpen && podeDevolver && (
              <DropdownMenuItem
                data-testid="devolver-ao-automatico"
                disabled={retomar.isPending}
                onSelect={() => retomar.mutate({ conversation_id: conversation.id })}
              >
                <Robot size={16} aria-hidden className="mr-2" />
                {t("Devolver ao automático")}
              </DropdownMenuItem>
            )}
            {podePausar && (
              <DropdownMenuItem
                data-testid="pausar-o-automatico"
                disabled={pausar.isPending}
                title={t("O atendimento automático para nesta conversa. O dono não muda.")}
                onSelect={() => pausar.mutate({ conversation_id: conversation.id })}
              >
                <Pause size={16} aria-hidden className="mr-2" />
                {t("Pausar o automático")}
              </DropdownMenuItem>
            )}
            {aberta && (
              <DropdownMenuItem onSelect={() => setReassignOpen(true)}>
                <UsersThree size={16} aria-hidden className="mr-2" />
                {t("Transferir")}
              </DropdownMenuItem>
            )}
            {aberta && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Clock size={16} aria-hidden className="mr-2" />
                  {lembreteAtivo ? t("Lembrete ativo") : t("Lembrar")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {lembreteAtivo ? (
                    <DropdownMenuItem
                      onSelect={() => snooze.cancel.mutate({ conversation_id: conversation.id })}
                    >
                      {t("Cancelar lembrete")}
                    </DropdownMenuItem>
                  ) : (
                    ([1, 3, 24] as const).map((horas) => (
                      <DropdownMenuItem
                        key={horas}
                        onSelect={() =>
                          snooze.snooze.mutate({
                            conversation_id: conversation.id,
                            duration_hours: horas,
                          })
                        }
                      >
                        {t(horas === 1 ? "Em 1 hora" : horas === 3 ? "Em 3 horas" : "Em 24 horas")}
                      </DropdownMenuItem>
                    ))
                  )}
                  {/* Os 1h/3h/24h avisam SÓ o atendente, se o cliente não
                      responder. Este manda mensagem ao CLIENTE na hora marcada. */}
                  {!conversation.is_group && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        data-testid="acao-agendar-mensagem"
                        onSelect={() => setAgendarOpen(true)}
                      >
                        <CalendarPlus size={16} aria-hidden className="mr-2" />
                        {t("Agendar mensagem…")}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            {c?.id && (
              <DropdownMenuItem
                data-testid="acao-ativar-fluxo"
                onSelect={() => setAtivarFluxoOpen(true)}
              >
                <FlowArrow size={16} aria-hidden className="mr-2" />
                {t("Ativar fluxo")}
              </DropdownMenuItem>
            )}
            {c?.id && (
              <DropdownMenuItem asChild>
                <Link href={`/app/contacts/${c.id}`}>
                  <UserCircle size={16} aria-hidden className="mr-2" />
                  {t("Ver contato")}
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href={exportar("pdf")} download data-testid="exportar-conversa-pdf">
                <FilePdf size={16} aria-hidden className="mr-2" />
                {t("Exportar conversa em PDF")}
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={exportar("xlsx")} download data-testid="exportar-conversa-excel">
                <FileXls size={16} aria-hidden className="mr-2" />
                {t("Exportar conversa em Excel")}
              </a>
            </DropdownMenuItem>
            {aberta && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  disabled={close.isPending}
                  onSelect={() => {
                    if (confirm(t("Fechar esta conversa?"))) {
                      close.mutate({ conversation_id: conversation.id });
                    }
                  }}
                >
                  <X size={16} aria-hidden className="mr-2" />
                  {t("Fechar conversa")}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ReassignDialog
        conversationId={conversation.id}
        open={reassignOpen}
        onOpenChange={setReassignOpen}
      />
      <AtivarFluxoDialog
        conversationId={conversation.id}
        contactId={c?.id ?? null}
        open={ativarFluxoOpen}
        onOpenChange={setAtivarFluxoOpen}
      />
      <AgendarMensagemDialog
        conversationId={conversation.id}
        channelSessionId={conversation.channel_session_id ?? null}
        nomeDoCliente={displayName}
        open={agendarOpen}
        onOpenChange={setAgendarOpen}
      />
    </div>
  );
}
