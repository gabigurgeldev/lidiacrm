"use client";
/**
 * RunsTable — tabela de execuções com Realtime (S-13.12).
 *
 * Mostra a página mais recente (limit 25). Click numa row → drawer com trace.
 */
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { useAgentRuns, type AgentRunRow } from "@/hooks/ai/useAgentRuns";
import { lerExecucao, type TomDaExecucao } from "@/lib/ai/agents/leitura-da-execucao";
import { useT } from "@/hooks/i18n/useT";
import { RunDetailDrawer } from "./RunDetailDrawer";

interface Props {
  agentId: string;
  active: boolean;
}

/** Cor da pílula pelo tom do desfecho (`lerExecucao`). */
const VARIANTE_DO_TOM: Record<TomDaExecucao, "default" | "secondary" | "destructive"> = {
  ok: "default",
  atencao: "secondary",
  erro: "destructive",
};

function fmtLatency(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function fmtCost(cents: number | null): string {
  if (cents == null) return "—";
  return `US$ ${(cents / 100).toFixed(4)}`;
}

export function RunsTable({ agentId, active }: Props) {
  const t = useT();
  const { data, isLoading, error, refetch, isFetching } = useAgentRuns(agentId, {
    enabled: active,
    realtime: active,
  });
  const [selected, setSelected] = React.useState<AgentRunRow | null>(null);
  const [open, setOpen] = React.useState(false);

  const rows = data?.data ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {isLoading ? t("Carregando…") : `${rows.length} ${t("execuções recentes")}`}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          {isFetching ? t("Atualizando…") : t("Atualizar")}
        </Button>
      </div>

      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {t("Erro ao carregar execuções.")}
        </p>
      ) : null}

      <div className="rounded-md border border-border/60">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[170px]">{t("Início")}</TableHead>
              <TableHead>{t("Status")}</TableHead>
              <TableHead>{t("Tipo")}</TableHead>
              <TableHead>{t("Tokens (in/out)")}</TableHead>
              <TableHead>{t("Custo")}</TableHead>
              <TableHead>{t("Latência")}</TableHead>
              <TableHead>{t("Steps")}</TableHead>
              <TableHead className="text-right">{t("Ações")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && !isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                  {t("Nenhuma execução ainda.")}
                </TableCell>
              </TableRow>
            ) : null}

            {rows.map((r) => (
              <TableRow
                key={r.id}
                className="cursor-pointer"
                onClick={() => {
                  setSelected(r);
                  setOpen(true);
                }}
              >
                <TableCell className="font-mono text-xs">
                  {new Date(r.started_at).toLocaleString()}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={VARIANTE_DO_TOM[lerExecucao(r.status, r.abort_reason).tom]}
                    className="text-xs"
                    data-testid="execucao-desfecho"
                  >
                    {t(lerExecucao(r.status, r.abort_reason).rotulo)}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs">
                  {r.is_dry_run ? (
                    <Badge variant="outline" className="text-xs">
                      {t("teste")}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">{t("produção")}</span>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {(r.tokens_in ?? 0).toLocaleString()} /{" "}
                  {(r.tokens_out ?? 0).toLocaleString()}
                </TableCell>
                <TableCell className="font-mono text-xs">{fmtCost(r.cost_cents)}</TableCell>
                <TableCell className="font-mono text-xs">{fmtLatency(r.latency_ms)}</TableCell>
                <TableCell className="font-mono text-xs">{r.steps_count ?? 0}</TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelected(r);
                      setOpen(true);
                    }}
                  >
                    {t("Detalhes")}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <RunDetailDrawer run={selected} open={open} onOpenChange={setOpen} />
    </div>
  );
}
