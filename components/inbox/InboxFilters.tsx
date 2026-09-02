"use client";
import { useT } from "@/hooks/i18n/useT";
import { useEffect, useState } from "react";
import { FunnelSimple, MagnifyingGlass } from "@/lib/ui/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TipoDeCanal } from "@/components/channels/TipoDeCanal";
import { channelLabel, useChannelSessions } from "@/hooks/channels/useChannelSessions";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useConversationTagVocabulary } from "@/hooks/inbox/useConversationTags";
import { useConversationCounts } from "@/hooks/inbox/useConversationCounts";
import type { Role, VisibilityMode } from "@/lib/auth/types";
import { cn } from "@/lib/utils";

export type InboxTab = "unassigned" | "mine" | "all" | "closed" | "ai";

const INBOX_TABS: { value: InboxTab; label: string }[] = [
  { value: "unassigned", label: "Fila" },
  { value: "mine", label: "Minhas" },
  { value: "all", label: "Todas" },
  { value: "closed", label: "Fechadas" },
  { value: "ai", label: "IA" },
];

/**
 * Visões visíveis por papel + escopo (G4-02, acceptance 1). 'Todas' fica oculta
 * para `agent` quando visibility_mode ≠ 'all'; viewer/manager/admin sempre veem.
 * É apenas cosmético — a RLS (G4-01) é quem garante o escopo mesmo via ?filter=all.
 */
export function visibleInboxTabs(role: Role, mode: VisibilityMode | undefined): InboxTab[] {
  const hideAll = role === "agent" && mode !== "all";
  return INBOX_TABS.filter((t) => !(t.value === "all" && hideAll)).map((t) => t.value);
}

export interface InboxFiltersValue {
  tab: InboxTab;
  search: string;
  onlyUnread: boolean;
  channel_session_id?: string;
  tag?: string;
}

interface Props {
  value: InboxFiltersValue;
  onChange: (next: InboxFiltersValue) => void;
}

/**
 * O topo da coluna de conversas.
 *
 * ═══ O que mudou de forma, e por quê ═══
 *
 * Eram CINCO controles empilhados — busca, número, tag, abas e um interruptor —
 * ocupando ~180px fixos numa coluna de 272px. Num notebook isso é um quarto da
 * altura gasto em filtros que se tocam uma vez por dia, e a lista de conversas
 * (o motivo da coluna existir) começava abaixo da dobra.
 *
 * Agora: busca, uma linha com o número e um botão de filtros, e as visões como
 * pílulas roláveis.
 *
 * ═══ ⚠️ O QUE **NÃO** FOI PARA DENTRO DO POPOVER, e a razão é um caso medido ═══
 *
 * O seletor de número FICA sempre visível. Existe um estado — filtro apontando
 * para um canal que o operador acabou de excluir — em que ele é o ÚNICO jeito de
 * voltar para "Todos os números"; sem ele à mão, o inbox segue filtrado,
 * possivelmente vazio, sem nada na tela explicando por quê. Esse caso tem teste
 * próprio (`inbox-filters-scope.test.tsx`), e escondê-lo atrás de um clique o
 * quebraria em silêncio.
 *
 * Tag e "apenas não lidos" recolhem porque não carregam estado que a pessoa
 * precise ver de relance — e, quando carregam, o contador no botão diz.
 */
export function InboxFilters({ value, onChange }: Props) {
  const t = useT();
  const [searchInput, setSearchInput] = useState(value.search);
  const { data: channels } = useChannelSessions({ refetchInterval: 30_000 });
  const { activeOrg } = useAuth();
  const { data: tagVocabulary } = useConversationTagVocabulary(activeOrg?.orgId ?? null);
  const { data: counts } = useConversationCounts(activeOrg?.orgId ?? null);

  const tabs = activeOrg
    ? visibleInboxTabs(activeOrg.role, activeOrg.visibility_mode)
    : INBOX_TABS.map((t) => t.value);
  const countFor: Partial<Record<InboxTab, number>> = {
    unassigned: counts?.unassigned,
    mine: counts?.mine,
    all: counts?.all,
  };
  // Filtrar por um número que saiu da lista (o operador acabou de excluir o
  // canal) deixa o inbox mostrando um subconjunto — às vezes vazio — sem nada na
  // tela dizendo que há filtro. O número some do dropdown junto com o canal, e o
  // alternador inteiro sumiria com ele se sobrasse menos de dois.
  const filtroForaDaLista =
    value.channel_session_id != null &&
    channels != null &&
    !channels.some((c) => c.id === value.channel_session_id);
  // Alternador só aparece com 2+ números — com um só não há o que alternar.
  const showChannelSwitch = (channels?.length ?? 0) >= 2 || filtroForaDaLista;
  const temTags = (tagVocabulary?.length ?? 0) > 0;
  // O contador do botão. Sem ele, um filtro esquecido dentro do popover deixa a
  // lista curta sem nenhum sinal na tela — o mesmo defeito que o seletor de
  // número resolve ficando à mostra.
  const filtrosAtivos = (value.tag ? 1 : 0) + (value.onlyUnread ? 1 : 0);

  // Debounce search input → propagate to parent.
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput !== value.search) {
        onChange({ ...value, search: searchInput });
      }
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  return (
    <div className="border-b border-border bg-background">
      <div className="px-3 pb-2 pt-3">
        <div className="relative">
          <MagnifyingGlass
            size={15}
            weight="regular"
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted"
            aria-hidden
          />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("Buscar mensagens…")}
            className="h-9 rounded-full border-transparent bg-surface-elevated pl-8 text-sm focus-visible:border-border"
            aria-label={t("Buscar conversas")}
          />
        </div>
      </div>

      {(showChannelSwitch || temTags) && (
        <div className="flex items-center gap-1.5 px-3 pb-2">
          {showChannelSwitch && (
            <Select
              value={value.channel_session_id ?? "all"}
              onValueChange={(v) =>
                onChange({ ...value, channel_session_id: v === "all" ? undefined : v })
              }
            >
              <SelectTrigger
                className="h-8 min-w-0 flex-1 rounded-full border-border text-xs"
                aria-label={t("Filtrar por número de WhatsApp")}
              >
                <SelectValue placeholder={t("Todos os números")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("Todos os números")}</SelectItem>
                {filtroForaDaLista && value.channel_session_id != null && (
                  <SelectItem value={value.channel_session_id}>{t("Número removido")}</SelectItem>
                )}
                {channels?.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {/*
                      O NOME E O TIPO juntos, porque a escolha é das duas coisas.
                      Dois números com nomes parecidos podem ter regras de envio
                      opostas — no canal oficial existe a janela de 24h, no
                      número por QR não existe —, e até aqui o seletor mostrava
                      só o apelido. Ver `lib/channels/tipo-de-conexao.ts`.
                    */}
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate">{channelLabel(c, t)}</span>
                      <TipoDeCanal provider={c.provider} className="shrink-0" />
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {temTags && (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    "h-8 shrink-0 gap-1.5 rounded-full px-2.5 text-xs",
                    filtrosAtivos > 0 && "border-accent text-accent",
                  )}
                  aria-label={t("Mais filtros")}
                  data-testid="inbox-mais-filtros"
                >
                  <FunnelSimple size={14} aria-hidden />
                  {filtrosAtivos > 0 && (
                    <span className="tabular-nums" data-testid="inbox-filtros-ativos">
                      {filtrosAtivos}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-60 space-y-3 rounded-[14px]">
                <div className="space-y-1.5">
                  <Label className="text-xs text-text-muted">{t("Tag da conversa")}</Label>
                  <Select
                    value={value.tag ?? "all"}
                    onValueChange={(v) => onChange({ ...value, tag: v === "all" ? undefined : v })}
                  >
                    <SelectTrigger className="h-8 text-sm" aria-label={t("Filtrar por tag")}>
                      <SelectValue placeholder={t("Todas as tags")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("Todas as tags")}</SelectItem>
                      {tagVocabulary?.map((tag) => (
                        <SelectItem key={tag} value={tag}>
                          {tag}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between">
                  <Label htmlFor="only-unread" className="text-xs text-text-muted">
                    {t("Apenas não lidos")}
                  </Label>
                  <Switch
                    id="only-unread"
                    checked={value.onlyUnread}
                    onCheckedChange={(v) => onChange({ ...value, onlyUnread: v })}
                  />
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      )}

      {/*
        ⚠️ CONTINUA SENDO O `Tabs` DO RADIX, e a caixa é que mudou.

        Era um `grid` de N colunas iguais: em 272px cada visão ficava com 54px e
        "Fechadas" truncava. Agora são pílulas de largura própria que rolam na
        horizontal — o que cabe, cabe; o que não cabe, alcança-se arrastando.

        Trocar por `<button>` soltos teria custado o `role="tab"`, a navegação
        por seta e o `aria-selected` que três testes usam como seletor — e que
        são a diferença entre uma fila de botões e um seletor de visão para quem
        usa leitor de tela.
      */}
      <Tabs value={value.tab} onValueChange={(v) => onChange({ ...value, tab: v as InboxTab })}>
        <TabsList className="nav-rolagem flex h-auto w-full justify-start gap-1 overflow-x-auto rounded-none bg-transparent px-3 pb-2">
          {tabs.map((tab) => {
            const meta = INBOX_TABS.find((t) => t.value === tab)!;
            const count = countFor[tab];
            return (
              <TabsTrigger
                key={tab}
                value={tab}
                className="h-7 shrink-0 gap-1.5 rounded-full px-3 text-xs data-[state=active]:bg-accent-soft data-[state=active]:text-accent data-[state=active]:shadow-none"
              >
                {t(meta.label)}
                {typeof count === "number" && count > 0 && (
                  // Bolinha, e não um número solto do mesmo tamanho do rótulo:
                  // antes "Fila 10" lia-se como um nome de duas palavras.
                  <span className="rounded-full bg-surface-elevated px-1.5 text-[10px] font-medium tabular-nums text-text-muted">
                    {count}
                  </span>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>
    </div>
  );
}
