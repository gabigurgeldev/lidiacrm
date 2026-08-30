"use client";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";

export interface ExecucaoDeFluxo {
  id: string;
  flow_id: string;
  version_id: string;
  status: string;
  current_node_id: string;
  outcome: string | null;
  last_error: string | null;
  attempts: number;
  steps_taken: number;
  lead_id: string | null;
  contact_id: string | null;
  started_at: string;
  completed_at: string | null;
  next_eval_at: string | null;
}

/** Meio minuto: uma execução em espera muda de estado no ritmo do cron (1×/min). */
const RECONFERIR_MS = 30_000;

export function useExecucoes(filtro: { status?: string; flowId?: string } = {}) {
  const params = new URLSearchParams();
  if (filtro.status !== undefined) params.set("status", filtro.status);
  if (filtro.flowId !== undefined) params.set("flow_id", filtro.flowId);
  const consulta = params.toString();

  return useQuery({
    queryKey: ["flow-executions", filtro.status ?? "todas", filtro.flowId ?? "todos"],
    refetchInterval: RECONFERIR_MS,
    queryFn: () =>
      apiClient
        .get<{ data: ExecucaoDeFluxo[] }>(
          `/api/v1/flows/executions${consulta === "" ? "" : `?${consulta}`}`,
        )
        .then((r) => r.data),
  });
}
