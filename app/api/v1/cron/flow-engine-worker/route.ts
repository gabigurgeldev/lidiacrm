/**
 * GET/POST /api/v1/cron/flow-engine-worker — o relógio do Flow Engine.
 *
 * Reclama as execuções vencidas de `flow_executions` e caminha cada uma até
 * bater numa espera, num fim, ou no teto do tick. Trigger Postgres nunca faz
 * HTTP; este cron é quem consome, no mesmo contrato dos demais.
 *
 * Auth: Bearer INTERNAL_CRON_SECRET|INTERNAL_SECRET, fail-closed.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { rodarTickDeFluxos } from "@/lib/flow-engine/engine";
import { garantirNosRegistrados } from "@/lib/flow-engine/register-all";
import { criarFlowAdminClient, criarPortas } from "@/lib/flow-engine/supabase-adapter";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const provided = bearer || (req.headers.get("x-cron-secret")?.trim() ?? "");
  const aceitos = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  if (aceitos.length === 0 || !provided || !aceitos.includes(provided)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  garantirNosRegistrados();
  const admin = createAdminClient();
  const relogio = () => new Date();

  let resumo;
  try {
    resumo = await rodarTickDeFluxos({
      db: criarFlowAdminClient(admin),
      relogio,
      portas: (exec) => criarPortas(admin, exec, relogio),
    });
  } catch (err) {
    const detalhe = err instanceof Error ? err.message : String(err);
    logger.error("[flow-engine-worker.cron] o tick estourou", { error: detalhe, requestId });
    return fail("internal_error", detalhe, 500, { requestId });
  }

  // Só audita tick que MEXEU em alguma coisa. Auditar toda batida encheria o
  // `api_audit_log` — append-only, retenção de 5 anos — de linhas vazias: numa
  // instalação parada, medido nesta VPS, 95% das entradas eram batida de cron.
  // Liveness de worker é assunto de log, não de trilha de auditoria.
  //
  // `claim_falhou` entra na condição porque é o ÚNICO caso em que todos os
  // contadores são zero e ainda assim algo aconteceu — o claim não chegou ao
  // banco. Sem esta cláusula, o tick que falhou é idêntico, na trilha, ao tick
  // de uma instalação sem nada a fazer.
  if (
    resumo.claim_falhou ||
    resumo.reclamadas ||
    resumo.avancadas ||
    resumo.esperando ||
    resumo.concluidas ||
    resumo.falhadas ||
    resumo.mortas
  ) {
    void audit({
      action: "flow.worker_run",
      organizationId: null,
      bypassedRls: true,
      metadata: { ...resumo },
      requestId,
    });
  }

  return ok(resumo, { requestId });
}

export async function GET(req: NextRequest): Promise<Response> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(req);
}
