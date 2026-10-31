"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocaleDeData } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import type { AgendamentoListado } from "@/lib/agenda/contrato";
import { ROTULO_DA_SITUACAO, SITUACOES_DO_AGENDAMENTO, type SituacaoDoAgendamento } from "@/lib/agenda/tipos";
import { apiClient } from "@/lib/api/client";
import { CalendarCheck, Robot } from "@/lib/ui/icons";

function situacaoDe(valor: string): SituacaoDoAgendamento {
  return (SITUACOES_DO_AGENDAMENTO as readonly string[]).includes(valor)
    ? (valor as SituacaoDoAgendamento)
    : "confirmed";
}

/**
 * Os PRÓXIMOS horários marcados deste cliente, no painel da conversa.
 *
 * A pergunta de quem atende é "esse cliente já tem horário?" — antes de oferecer
 * outro, e antes de responder "confirmado?" no WhatsApp. A rota já responde a
 * partir de agora quando não há período (piso "agora" em `listaAgendamentos`), e
 * já recorta pelo escopo de quem pergunta (0249): o atendente vê os que são da
 * agenda dele e os que ele mesmo marcou, a gerência vê todos.
 *
 * A chave começa por `["agenda", "agendamentos"]` de propósito: marcar
 * (`useMarcarAgendamento`) e o tempo real da agenda invalidam `["agenda"]`, e
 * a lista se atualiza sozinha depois de marcar pelo diálogo ao lado.
 */
export function AgendamentosDoContato({
  contactId,
  onMarcar,
}: {
  contactId: string;
  /** Ausente = quem olha não pode marcar (viewer). */
  onMarcar?: () => void;
}) {
  const t = useT();
  const localeDaData = useLocaleDeData();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["agenda", "agendamentos", "contato", contactId],
    queryFn: async (): Promise<AgendamentoListado[]> => {
      const qs = new URLSearchParams({ contact_id: contactId, limite: "5" });
      const r = await apiClient.get<{ data: AgendamentoListado[] }>(`/api/v1/agenda/agendamentos?${qs.toString()}`);
      return (r as unknown as { data?: AgendamentoListado[] }).data ?? (r as unknown as AgendamentoListado[]) ?? [];
    },
  });
  const proximos = (data ?? []).filter((a) => a.situacao !== "cancelled");

  return (
    <section data-testid="inbox-agendamentos" className="bg-background px-6 py-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm text-muted-foreground">{t("Próximos horários")}</h3>
        {onMarcar ? (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" data-testid="painel-marcar-horario" onClick={onMarcar}>
            <CalendarCheck size={14} aria-hidden className="mr-1" />
            {t("Marcar")}
          </Button>
        ) : null}
      </div>
      {isLoading ? (
        <Skeleton className="mt-2 h-12 w-full" />
      ) : isError ? (
        <p className="mt-2 text-xs text-text-subtle">{t("Não consegui ler os horários deste cliente agora.")}</p>
      ) : proximos.length === 0 ? (
        <p className="mt-2 text-xs text-text-subtle" data-testid="sem-agendamentos-do-contato">
          {t("Nenhum horário marcado.")}
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {proximos.map((a) => {
            const situacao = situacaoDe(a.situacao);
            return (
              <li key={a.id}>
                <Link
                  href={`/app/agenda?agendamento=${a.id}`}
                  data-testid="agendamento-do-contato"
                  className="-mx-2 flex items-start gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-surface-elevated"
                >
                  <div className="flex w-12 shrink-0 flex-col items-center rounded-md border border-border py-1 leading-none">
                    <span className="text-[10px] uppercase text-text-muted">
                      {format(new Date(a.iniciaEm), "MMM", { locale: localeDaData }).replace(".", "")}
                    </span>
                    <span className="text-base font-semibold tabular-nums">{format(new Date(a.iniciaEm), "d")}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      <span className="font-medium tabular-nums">{format(new Date(a.iniciaEm), "HH:mm")}</span>{" "}
                      {t(a.titulo)}
                    </p>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <Badge variant={situacao === "pending" ? "warning" : "neutral"} className="text-[10px]">
                        {t(ROTULO_DA_SITUACAO[situacao])}
                      </Badge>
                      {a.origem === "mcp" ? (
                        <span className="flex items-center gap-0.5 text-[10px] text-text-subtle">
                          <Robot size={11} aria-hidden />
                          {t("pela IA")}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
