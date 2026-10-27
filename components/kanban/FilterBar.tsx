"use client";
import { useEffect, useMemo, useState } from "react";
import { useT } from "@/hooks/i18n/useT";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useUser } from "@/hooks/auth/AuthProvider";
import { useAssignableMembers } from "@/hooks/inbox/useAssignableMembers";
import { useAssignableAgents } from "@/hooks/kanban/useAssignableAgents";
import type { Lead, OwnerKind } from "@/lib/types/leads";
import { OwnerBadge } from "./OwnerBadge";
import { MagnifyingGlass } from "@/lib/ui/icons";
import { TagChip } from "@/components/tags/TagChip";
import { useTags } from "@/hooks/tags/useTags";
import {
  agentOwnerFilter,
  parseAgentOwnerFilter,
  tagsDoLead,
  type LeadFilters,
} from "@/lib/kanban/filters";
import { cn } from "@/lib/utils";

interface FilterBarProps {
  filters: LeadFilters;
  onChange: (next: LeadFilters) => void;
  leads: Lead[];
}

const STATUS_OPTIONS: Array<{ value: NonNullable<LeadFilters["status"]>; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "open", label: "Abertos" },
  { value: "won", label: "Ganhos" },
  { value: "lost", label: "Perdidos" },
];

export function FilterBar({ filters, onChange, leads }: FilterBarProps) {
  const t = useT();
  const user = useUser();
  const { data: members } = useAssignableMembers(true);
  const { data: agents } = useAssignableAgents(true);
  const [searchInput, setSearchInput] = useState(filters.search ?? "");

  // Debounce search 250ms
  useEffect(() => {
    const t = setTimeout(() => {
      if ((filters.search ?? "") !== searchInput) {
        onChange({ ...filters, search: searchInput });
      }
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  // As opções vêm do CATÁLOGO (com cor) e de quem está no quadro — uma tag em
  // uso que o catálogo ainda não listou não pode sumir do filtro.
  const { data: catalogo } = useTags();
  const corDaTag = useMemo(
    () => new Map((catalogo ?? []).map((tg) => [tg.name, tg.color])),
    [catalogo],
  );
  const tagOptions = useMemo(() => {
    const set = new Set<string>();
    for (const l of leads) for (const tg of tagsDoLead(l)) set.add(tg);
    for (const tg of catalogo ?? []) set.add(tg.name);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [leads, catalogo]);

  const filteredAgentId = parseAgentOwnerFilter(filters.owner);

  /**
   * Responsáveis atribuíveis numa lista única — humanos e agentes ordenados
   * juntos. O dono de um lead é UM campo; quem pode ser dono aparece numa lista
   * só. A distinção é geométrica (avatar), nunca posicional.
   */
  const assignees = useMemo(() => {
    type Row = {
      key: string;
      owner: string;
      name: string;
      kind: OwnerKind;
      version: number | null;
    };
    const rows: Row[] = [
      ...(members ?? [])
        .filter((m) => m.user_id !== user.id)
        .map((m) => ({
          key: `u:${m.user_id}`,
          owner: m.user_id,
          name: m.full_name ?? t("Sem nome"),
          kind: "user" as OwnerKind,
          version: null,
        })),
      ...(agents ?? []).map((a) => ({
        key: `a:${a.agent_id}`,
        owner: agentOwnerFilter(a.agent_id),
        name: a.name,
        kind: "ai" as OwnerKind,
        version: a.version_number,
      })),
    ];
    return rows.sort((x, y) => x.name.localeCompare(y.name, "pt-BR"));
  }, [members, agents, user.id, t]);
  const ownerLabel =
    filters.owner === "unassigned"
      ? t("Sem responsável")
      : !filters.owner || filters.owner === "any"
        ? t("Todos")
        : filteredAgentId
          ? (agents?.find((a) => a.agent_id === filteredAgentId)?.name ?? t("Agente"))
          : filters.owner === user.id
            ? t("Eu")
            : (members?.find((m) => m.user_id === filters.owner)?.full_name ??
              t("Responsável"));

  const tagLabel = filters.tag ?? t("Tag: todas");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-64">
        <MagnifyingGlass
          size={15}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
          aria-hidden
        />
        <Input
          type="search"
          placeholder={t("Buscar negócio ou contato…")}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="h-9 rounded-full pl-9"
          aria-label={t("Buscar negócio ou contato…")}
        />
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 rounded-full">
            {t("Responsável")}: {ownerLabel}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>{t("Responsável")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onChange({ ...filters, owner: "any" })}>
            {t("Todos")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onChange({ ...filters, owner: "unassigned" })}>
            {t("Sem responsável")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onChange({ ...filters, owner: user.id })}>
            {t("Eu")}
          </DropdownMenuItem>
          {/*
            Humanos e agentes numa lista SÓ, ordenados juntos por nome. Não existe
            separador entre eles: separador agrupa, e agrupar comunica "as pessoas,
            e depois também os bots" — segregação por posição, que é a mesma ideia
            do badge "AI" colorido que o contrato de UI proíbe. Quem distingue é o
            avatar (disco preenchido = humano, círculo vazado com anel = agente),
            reusando o OwnerBadge do card para os dois não divergirem.
            O separador ACIMA (linha do "Eu") fica: ele divide as opções meta
            (Todos / Sem responsável / Eu) das pessoas, e ali agrupar está certo.
          */}
          {assignees.length > 0 && (
            <>
              <DropdownMenuSeparator />
              {assignees.map((a) => (
                <DropdownMenuItem key={a.key} onClick={() => onChange({ ...filters, owner: a.owner })}>
                  <OwnerBadge
                    ownerKind={a.kind}
                    ownerName={a.name}
                    agentVersion={a.version}
                  />
                </DropdownMenuItem>
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Status como controle segmentado (iOS): quatro estados, sempre à vista —
          escolher qual vista se olha não é ação, por isso não é botão de accent. */}
      <div className="ios-segmentado" role="radiogroup" aria-label={t("Status")}>
        {STATUS_OPTIONS.map((o) => {
          const ativo = (filters.status ?? "all") === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={ativo}
              onClick={() => onChange({ ...filters, status: o.value })}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                ativo ? "bg-surface text-text shadow-xs" : "text-text-muted hover:text-text",
              )}
              data-testid={`status-${o.value}`}
            >
              {t(o.label)}
            </button>
          );
        })}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 rounded-full" disabled={tagOptions.length === 0}>
            {tagLabel}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => onChange({ ...filters, tag: undefined })}>
            {t("Todas")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {tagOptions.map((tag) => (
            <DropdownMenuItem key={tag} onClick={() => onChange({ ...filters, tag })}>
              <TagChip nome={tag} cor={corDaTag.get(tag) ?? "#64748b"} tamanho="sm" />
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <label
        className={cn(
          "flex h-8 cursor-pointer select-none items-center gap-2 rounded-full border border-border px-3 text-xs font-medium",
          filters.overdueOnly && "border-accent bg-accent/10",
        )}
      >
        <input
          type="checkbox"
          checked={!!filters.overdueOnly}
          onChange={(e) => onChange({ ...filters, overdueOnly: e.target.checked })}
        />
        {t("Apenas atrasados")}
      </label>

      {(filters.search ||
        filters.owner ||
        filters.tag ||
        filters.overdueOnly ||
        (filters.status && filters.status !== "all")) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setSearchInput("");
            onChange({ status: "all" });
          }}
        >
          {t("Limpar filtros")}
        </Button>
      )}
    </div>
  );
}
