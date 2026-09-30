"use client";

import { useLocaleDeData } from "@/hooks/i18n/useLocaleDeData";

import type { Locale } from "date-fns";
import { format, formatDistanceToNowStrict } from "date-fns";
import { useT } from "@/hooks/i18n/useT";
import { Prohibit, Robot } from "@/lib/ui/icons";
import { AvatarDoContato } from "@/components/inbox/AvatarDoContato";
import { TipoDeCanal } from "@/components/channels/TipoDeCanal";
import { OwnerBadge } from "@/components/kanban/OwnerBadge";
import { comandoDaConversa } from "@/lib/inbox/comando-da-conversa";
import { cn } from "@/lib/utils";
import type { ConversationWithContact } from "@/hooks/inbox/useConversationsRealtime";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";

interface Props {
  conversation: ConversationWithContact;
  isSelected: boolean;
  onSelect: (id: string) => void;
  /** Posição 1-based na fila (G5-03). Presente só na visão Fila. */
  queuePosition?: number;
  /**
   * Mostrar POR ONDE a conversa entrou.
   *
   * Só com mais de um número conectado. Com um só, o rótulo seria a mesma
   * palavra em toda linha da lista — ruído que ensina o olho a ignorar a área
   * onde vivem os avisos que importam (bloqueado, tags).
   */
  mostrarCanal?: boolean;
  /**
   * Mostrar QUEM está no comando de cada conversa.
   *
   * Mesma regra do canal, e pelo mesmo motivo: só quando o rótulo DISCRIMINA. Nas
   * abas "Fila" (todas sem dono), "Minhas" (todas do mesmo dono) e "IA" o badge
   * seria a mesma palavra em toda linha — ruído que ensina o olho a ignorar a
   * área onde vivem os avisos que importam. Quem decide é a lista, que é quem
   * sabe quantos donos distintos ela tem.
   */
  mostrarAtendente?: boolean;
  /**
   * A org tem atendimento automático de pé? Vem por PROP e não por hook: um hook
   * por linha faria 50 assinaturas de query na mesma lista para responder a MESMA
   * pergunta org-wide. `undefined` = "não sei", e a função trata isso como "não
   * afirme nada".
   */
  automaticoDaOrg?: boolean;
}

function relativeTime(iso: string | null, locale: Locale): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return format(d, "HH:mm");
  const diff = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
  if (diff < 7) return formatDistanceToNowStrict(d, { addSuffix: false, locale: locale });
  return format(d, "dd/MM");
}

/** "Aguardando há 5 min" — desde a última mensagem do cliente (fallback: criação). */
function waitingLabel(
  conversation: ConversationWithContact,
  t: (texto: string) => string = (texto) => texto,
  locale: Locale,
): string {
  const since = conversation.last_inbound_at ?? conversation.created_at;
  if (!since) return t("Aguardando");
  return `${t("Aguardando")} ${formatDistanceToNowStrict(new Date(since), { addSuffix: true, locale: locale })}`;
}

export function ConversationListItem({
  conversation,
  isSelected,
  onSelect,
  queuePosition,
  mostrarCanal,
  mostrarAtendente,
  automaticoDaOrg,
}: Props) {
  const localeDaData = useLocaleDeData();
  const t = useT();
  const c = conversation.contacts ?? null;
  const displayName = rotuloDoContato(c);
  const preview = conversation.last_message_preview?.trim() || t("Sem mensagens");
  const truncated = preview.length > 60 ? `${preview.slice(0, 60)}…` : preview;
  const time = relativeTime(conversation.last_message_at, localeDaData);
  const unread = conversation.unread_count_for_assignee ?? 0;

  /**
   * Quem manda, pela MESMA regra do cabeçalho.
   *
   * `status === 'ai_handling'` era um proxy ruim e foi medido: o único escritor
   * desse status em produção é o botão "Devolver ao automático", então o ícone de
   * robô aparecia só em conversa que já tinha sido escalada E devolvida — nunca
   * na que o automático atendeu do começo ao fim, que é a maioria.
   */
  const { comando } = comandoDaConversa({
    status: conversation.status,
    assigned_to_user_id: conversation.assigned_to_user_id,
    assigned_to_user_name: conversation.assigned_to_user_name ?? null,
    assignee_kind: conversation.assignee_kind ?? null,
    bot_silenced_until: conversation.bot_silenced_until ?? null,
    force_human: c?.force_human ?? null,
    automaticoDaOrg,
  });
  const isAi = comando.quem === "automatico";

  // O número DA EMPRESA por onde esta conversa chegou — não o do cliente. Com
  // dois canais é o que decide o tom da resposta e qual número a pessoa vê
  // respondendo. Cai no nome do canal quando não há número (canal recém-criado).
  const canal = conversation.channel_sessions ?? null;
  const rotuloCanal = canal?.phone_number ?? canal?.display_name ?? null;

  // Na fila, o que importa é HÁ QUANTO TEMPO a pessoa espera — então a hora
  // da última mensagem dá lugar à posição e à espera, na linha de baixo.
  const naFila = queuePosition !== undefined;

  return (
    <button
      type="button"
      data-conversation-id={conversation.id}
      onClick={() => onSelect(conversation.id)}
      // Linha de mensageiro: sem divisória, sem selos empilhados. O que o olho
      // varre numa lista de conversas é rosto, nome, hora e a última frase — o
      // resto (dono, tags, canal) mora no cabeçalho e no perfil. As linhas
      // entre conversas e a fileira de selos em cada item eram o que fazia a
      // lista parecer planilha.
      className={cn(
        "group relative mx-2 flex w-[calc(100%-1rem)] items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors hover:bg-surface-elevated/70",
        isSelected && "bg-surface-elevated hover:bg-surface-elevated",
      )}
      aria-current={isSelected ? "true" : undefined}
    >
      {/* A MESMA regra de foto que o cabeçalho e o perfil — ver `AvatarDoContato`. */}
      <AvatarDoContato
        contactId={c?.id}
        temFoto={Boolean(c?.avatar_storage_path)}
        anonimizado={c?.is_anonymized}
        nome={displayName}
        className="h-12 w-12 shrink-0"
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              "flex min-w-0 items-center gap-1 text-[16px] leading-[21px] text-foreground",
              c?.is_anonymized && "italic text-muted-foreground",
            )}
          >
            <span className="truncate">{displayName}</span>
            {c?.is_blocked && (
              <span title={t("Bloqueado")} className="shrink-0 text-destructive">
                <Prohibit size={13} weight="bold" aria-label={t("Bloqueado")} />
              </span>
            )}
          </span>
          {/* Hora VERDE quando há não lidas — o sinal do WhatsApp para "tem
              coisa nova aqui", antes mesmo de o olho chegar no contador. */}
          <span
            className={cn(
              "shrink-0 text-xs tabular-nums",
              unread > 0 ? "font-medium text-accent" : "text-muted-foreground",
            )}
          >
            {time}
          </span>
        </div>

        <div className="mt-0.5 flex items-center gap-1.5">
          {naFila ? (
            <p className="min-w-0 flex-1 truncate text-[13px] leading-5 text-muted-foreground">
              <span
                className="mr-1 font-medium tabular-nums text-accent"
                aria-label={`${t("Posição")} ${queuePosition} ${t("na fila")}`}
              >
                {queuePosition}º
              </span>
              {waitingLabel(conversation, t, localeDaData)}
            </p>
          ) : (
            <p className="min-w-0 flex-1 truncate text-sm leading-5 text-muted-foreground">
              {isAi ? (
                <Robot size={13} weight="duotone" className="mr-1 inline -translate-y-px" aria-hidden />
              ) : null}
              {truncated}
            </p>
          )}
          {/* Por qual número a conversa entrou: só o selo do TIPO (QR, oficial),
              com o número no `title`. Com um número só não há o que distinguir. */}
          {mostrarCanal && rotuloCanal && (
            <span
              className="flex shrink-0 items-center text-muted-foreground"
              title={`${t("Entrou por")} ${rotuloCanal}`}
            >
              <TipoDeCanal provider={canal?.provider} variante="bolha" />
            </span>
          )}
          {mostrarAtendente && comando.quem === "humano" && (
            <span className="shrink-0" title={comando.nome ?? t("Atendente")}>
              <OwnerBadge ownerKind="user" ownerName={comando.nome ?? t("Atendente")} compacto />
            </span>
          )}
          {unread > 0 && (
            <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold tabular-nums text-accent-foreground">
              {unread}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
