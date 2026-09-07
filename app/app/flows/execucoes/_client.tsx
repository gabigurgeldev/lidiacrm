"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/hooks/i18n/useT";
import { useExecucoes, type ExecucaoDeFluxo } from "@/hooks/flows/useFlowExecutions";
import { useFluxos } from "@/hooks/flows/useFlows";

/**
 * Execuções E erros na mesma tela, separados por filtro.
 *
 * Não há tela de "fila de erro" à parte porque não há tabela à parte: uma
 * execução que parou é uma linha com `status='dead'`. Duas telas sobre a mesma
 * tabela divergiriam no primeiro filtro que alguém acrescentasse só numa.
 */

const FILTROS = [
  { id: "todas", rotulo: "Todas" },
  { id: "waiting", rotulo: "Esperando" },
  { id: "completed", rotulo: "Concluídas" },
  { id: "dead", rotulo: "Pararam com erro" },
] as const;

export function ExecucoesClient() {
  const t = useT();
  const [filtro, setFiltro] = useState<string>("todas");
  const { data: fluxos } = useFluxos();
  const { data: execucoes, isLoading } = useExecucoes(
    filtro === "todas" ? {} : { status: filtro },
  );

  const nomeDoFluxo = (id: string) => fluxos?.find((f) => f.id === id)?.name ?? id;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2" data-testid="filtros-de-execucao">
        {FILTROS.map((f) => (
          <Button
            key={f.id}
            variant={filtro === f.id ? "default" : "outline"}
            size="sm"
            onClick={() => setFiltro(f.id)}
            data-testid={`filtro-${f.id}`}
          >
            {t(f.rotulo)}
          </Button>
        ))}
      </div>

      {isLoading && <Skeleton className="h-40 w-full" />}

      {!isLoading && (execucoes?.length ?? 0) === 0 && (
        <Card className="p-8 text-center" data-testid="execucoes-vazio">
          <p className="text-sm font-medium">{t("Nada por aqui ainda.")}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "Assim que um fluxo ligado for disparado por um lead novo, a execução dele aparece nesta lista.",
            )}
          </p>
        </Card>
      )}

      <ul className="flex flex-col gap-2" data-testid="lista-de-execucoes">
        {(execucoes ?? []).map((e) => (
          <LinhaDaExecucao key={e.id} execucao={e} nomeDoFluxo={nomeDoFluxo(e.flow_id)} />
        ))}
      </ul>
    </div>
  );
}

function LinhaDaExecucao({
  execucao,
  nomeDoFluxo,
}: {
  execucao: ExecucaoDeFluxo;
  nomeDoFluxo: string;
}) {
  const t = useT();
  const morreu = execucao.status === "dead";

  return (
    <li>
      <Card className="flex items-start gap-4 p-4" data-testid={`execucao-${execucao.id}`}>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{nomeDoFluxo}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("Parou no bloco")} <code className="font-mono">{execucao.current_node_id}</code>
            {" · "}
            {t("passos")}: {execucao.steps_taken}
          </p>
          {morreu && execucao.last_error !== null && (
            <p
              className="mt-1 text-xs text-destructive"
              data-testid={`erro-da-execucao-${execucao.id}`}
            >
              {execucao.last_error}
            </p>
          )}
          {execucao.outcome !== null && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("Desfecho")}: {execucao.outcome}
            </p>
          )}
        </div>
        <Badge variant={morreu ? "destructive" : "secondary"}>{t(NOME_DO_ESTADO[execucao.status] ?? execucao.status)}</Badge>
      </Card>
    </li>
  );
}

/**
 * Português de operação para o estado. Nunca a palavra do banco.
 *
 * Exportado porque a tela de execuções DE UM FLUXO mostra os mesmos estados —
 * um segundo dicionário divergiria no primeiro estado novo, e o jeito de
 * descobrir seria ver "waiting" cru numa tela e "Esperando" na outra.
 */
export const NOME_DO_ESTADO: Record<string, string> = {
  pending: "Na fila",
  running: "Rodando",
  waiting: "Esperando",
  paused: "Pausada",
  completed: "Concluída",
  cancelled: "Cancelada",
  dead: "Parou com erro",
};
