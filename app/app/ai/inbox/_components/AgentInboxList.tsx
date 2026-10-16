"use client";

import { useLocaleDeData } from "@/hooks/i18n/useLocaleDeData";
import { useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAgentInbox, useResolverLacuna, useUpdateInboxItem, type AgentInboxItem } from "@/hooks/ai/useAgentInbox";
import { EnsinarLacunaDialog } from "./EnsinarLacunaDialog";
import { kindLabel, SEVERITY_LABEL, type AgentInboxSeverity } from "@/lib/ai/agent-inbox-copy";
import { Bell, BookOpen, Check } from "@/lib/ui/icons";
import { useT } from "@/hooks/i18n/useT";
import { GATILHO_DA_ABA, SEGMENTADO_ABAS } from "@/components/ajustes";

const SEVERITY_VARIANT: Record<AgentInboxSeverity, "info" | "warning" | "error"> = {
  info: "info",
  warn: "warning",
  critical: "error",
};

export function AgentInboxList({ canResolve, canTeach = false }: { canResolve: boolean; canTeach?: boolean }) {
  const t = useT();
  const [tab, setTab] = useState<"open" | "resolved">("open");
  const { data, isLoading } = useAgentInbox(tab);
  const update = useUpdateInboxItem();

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <Tabs value={tab} onValueChange={(v) => setTab(v as "open" | "resolved")}>
        <TabsList className={`${SEGMENTADO_ABAS} max-w-full self-start overflow-x-auto`}>
          <TabsTrigger value="open" className={GATILHO_DA_ABA}>
            {t("Abertos")}{data ? ` (${data.open_count})` : ""}
          </TabsTrigger>
          <TabsTrigger value="resolved" className={GATILHO_DA_ABA}>{t("Resolvidos")}</TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : !data || data.items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center">
          <Bell size={28} className="text-muted-foreground/60" aria-hidden />
          <p className="text-sm font-medium">
            {tab === "open" ? t("Nenhum aviso em aberto") : t("Nenhum aviso resolvido")}
          </p>
          <p className="text-xs text-muted-foreground">
            {tab === "open"
              ? t("Quando o assistente precisar de você, o aviso aparece aqui.")
              : t("Avisos que você marcar como resolvidos ficam aqui.")}
          </p>
        </div>
      ) : (
        <ul className="ios-grupo">
          {data.items.map((item) => (
            <InboxRow
              key={item.id}
              item={item}
              canResolve={canResolve}
              canTeach={canTeach}
              pending={update.isPending}
              onToggle={(status) => update.mutate({ id: item.id, status })}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function InboxRow({
  item,
  canResolve,
  canTeach,
  pending,
  onToggle,
}: {
  item: AgentInboxItem;
  canResolve: boolean;
  canTeach: boolean;
  pending: boolean;
  onToggle: (status: "open" | "resolved") => void;
}) {
  const localeDaData = useLocaleDeData();
  const t = useT();
  const when = formatDistanceToNowStrict(new Date(item.created_at), {
    addSuffix: true,
    locale: localeDaData,
  });
  return (
    <li className="flex items-start gap-3 px-4 py-3" data-testid="inbox-item">
      <Badge variant={SEVERITY_VARIANT[item.severity]} className="mt-0.5 shrink-0">
        {t(SEVERITY_LABEL[item.severity])}
      </Badge>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{item.title}</p>
        <p className="text-xs text-muted-foreground">
          {kindLabel(item.kind, t)} · {when}
        </p>
        {item.body ? <p className="mt-1 text-xs text-muted-foreground">{item.body}</p> : null}
        {canTeach && item.status === "open" && item.lacuna?.status === "aberta" ? (
          <AcoesDaLacuna item={item} />
        ) : null}
      </div>
      {canResolve ? (
        item.status === "resolved" ? (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => onToggle("open")}>
            {t("Reabrir")}
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => onToggle("resolved")}>
            <Check size={14} aria-hidden />
            {t("Marcar resolvido")}
          </Button>
        )
      ) : null}
    </li>
  );
}

/**
 * Central de lacunas (0245). Ensinar e descartar fecham o aviso no servidor —
 * por isso nenhum dos dois passa pelo "Marcar resolvido". Só manager+ vê:
 * é o gate humano da base de conhecimento.
 */
function AcoesDaLacuna({ item }: { item: AgentInboxItem }) {
  const t = useT();
  const [aberto, setAberto] = useState(false);
  const resolver = useResolverLacuna();
  const lacuna = item.lacuna;
  if (lacuna === undefined) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <Button size="sm" onClick={() => setAberto(true)} data-testid="lacuna-abrir">
        <BookOpen size={14} aria-hidden />
        {t("Responder e ensinar o agente")}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={resolver.isPending}
        onClick={() => resolver.mutate({ id: lacuna.id, acao: "descartar" })}
        data-testid="lacuna-descartar"
      >
        {t("Não é para o material")}
      </Button>
      {aberto ? <EnsinarLacunaDialog lacuna={lacuna} aberto={aberto} onFechar={() => setAberto(false)} /> : null}
    </div>
  );
}
