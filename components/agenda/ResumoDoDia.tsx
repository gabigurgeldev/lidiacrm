"use client";

import { format } from "date-fns";
import * as React from "react";

import { useLocaleDeData } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { CalendarBlank, Clock, Hourglass } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

import type { Agendamento } from "./tipos";

/**
 * A faixa "como está o dia" acima da grade: quantos compromissos hoje, qual é o
 * próximo e quantos esperam confirmação.
 *
 * A pergunta que a recepção faz ao abrir a Agenda é "o que vem agora?", e a
 * grade semanal responde com um olhar de sete colunas. Esta faixa responde em
 * uma linha — no escopo de quem olha (a própria agenda para o atendente, a da
 * equipe para a gerência), porque a lista que recebe já vem recortada.
 *
 * Pura: recebe a lista de HOJE e o `agora` injetado, como a grade.
 */
export function ResumoDoDia({
  agendamentos,
  agora,
  onAbrir,
  className,
}: {
  /** Os compromissos de hoje. Ocupação do Google e cancelados são ignorados aqui. */
  agendamentos: Agendamento[];
  agora: Date;
  onAbrir?: (id: string) => void;
  className?: string;
}) {
  const t = useT();
  const localeDaData = useLocaleDeData();

  const vivos = React.useMemo(
    () =>
      agendamentos
        .filter((a) => a.origem !== "google_sync" && (a.situacao === "confirmed" || a.situacao === "pending"))
        .sort((a, b) => a.comeca.localeCompare(b.comeca)),
    [agendamentos],
  );
  const proximo = vivos.find((a) => new Date(a.termina).getTime() > agora.getTime()) ?? null;
  const aguardando = vivos.filter((a) => a.situacao === "pending").length;
  const emAndamento = proximo ? new Date(proximo.comeca).getTime() <= agora.getTime() : false;

  return (
    <div
      data-testid="resumo-do-dia"
      className={cn(
        "flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm",
        className,
      )}
    >
      <span className="flex items-center gap-1.5" data-testid="resumo-hoje">
        <CalendarBlank size={16} weight="bold" className="text-text-muted" aria-hidden />
        <span className="text-text-muted">{t("Hoje")}:</span>
        <span className="font-semibold tabular-nums">{vivos.length}</span>
        <span className="text-text-muted">{vivos.length === 1 ? t("agendamento") : t("agendamentos")}</span>
      </span>

      <span className="flex min-w-0 items-center gap-1.5" data-testid="resumo-proximo">
        <Clock size={16} weight="bold" className="shrink-0 text-text-muted" aria-hidden />
        {proximo ? (
          <button
            type="button"
            disabled={!onAbrir}
            onClick={onAbrir ? () => onAbrir(proximo.id) : undefined}
            className={cn("flex min-w-0 items-center gap-1.5 text-left", onAbrir && "hover:underline")}
          >
            <span className="text-text-muted">{emAndamento ? t("Agora") : t("Próximo")}:</span>
            <span className="font-semibold tabular-nums">
              {format(new Date(proximo.comeca), "HH:mm", { locale: localeDaData })}
            </span>
            <span className="truncate">
              {proximo.quemSeraAtendido ?? t(proximo.titulo)}
              {proximo.quemSeraAtendido ? <span className="text-text-muted"> · {t(proximo.titulo)}</span> : null}
            </span>
          </button>
        ) : (
          <span className="text-text-muted">{t("Nada mais marcado para hoje")}</span>
        )}
      </span>

      {aguardando > 0 ? (
        <span className="flex items-center gap-1.5 text-warning" data-testid="resumo-aguardando">
          <Hourglass size={16} weight="bold" aria-hidden />
          <span className="font-semibold tabular-nums">{aguardando}</span>
          <span>{t("aguardando confirmação")}</span>
        </span>
      ) : null}
    </div>
  );
}
