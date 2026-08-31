/**
 * GET/POST /api/v1/cron/bulk-send-worker — o relógio do disparo em massa.
 *
 * Promove os agendados, reclama os disparos vencidos e envia dentro de um
 * orçamento de tempo, no ritmo que `decidePacing` autorizar. A regra inteira
 * está em `lib/bulk-send/motor.ts`; aqui é só relógio, transporte e trilha —
 * mesmo contrato dos demais crons.
 *
 * Auth: Bearer INTERNAL_CRON_SECRET|INTERNAL_SECRET, fail-closed.
 *
 * ═══ Por que o envio passa pelo `sendMessageHandler` ═══
 *
 * Porque ele é o ponto ÚNICO de saída do sistema (UI, agente, automação e MCP
 * passam por lá), e é onde moram o veto de `is_blocked`, o pré-voo do contrato
 * de template, a resolução de endereço por canal, o registro em `messages`, a
 * auditoria `message.sent` e o `emit_event`. Um caminho de saída novo para o
 * disparo nasceria sem tudo isso — e sem herdar o próximo conserto.
 *
 * ═══ Auditoria: só a rodada que MEXEU em alguma coisa ═══
 *
 * Auditar toda batida encheria o `api_audit_log` — append-only, retenção de 5
 * anos — de linha vazia: numa VPS real, 95% da trilha era batida de cron parada.
 * `houveEfeito()` inclui `claim_falhou` de propósito: é o ÚNICO caso em que
 * todos os contadores são zero e ainda assim algo aconteceu (o claim não chegou
 * ao banco). Sem ele, tique quebrado e instalação parada são a MESMA linha.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { criarDisparoDb } from "@/lib/bulk-send/db";
import { enviarUmDoDisparo } from "@/lib/bulk-send/enviar";
import { houveEfeito, rodarTiqueDeDisparo } from "@/lib/bulk-send/motor";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const provided = bearer || (req.headers.get("x-cron-secret")?.trim() ?? "");
  const accepted = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  if (accepted.length === 0 || !provided || !accepted.includes(provided)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  const admin = createAdminClient();

  let resumo;
  try {
    resumo = await rodarTiqueDeDisparo({
      db: criarDisparoDb(admin),
      relogio: () => new Date(),
      dormir: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      enviar: enviarUmDoDisparo,
    });
  } catch (err) {
    const detalhe = err instanceof Error ? err.message : String(err);
    logger.error("[bulk-send-worker.cron] o tique estourou", { error: detalhe, requestId });
    return fail("internal_error", detalhe, 500, { requestId });
  }

  if (houveEfeito(resumo)) {
    void audit({
      action: "bulk_send.worker_run",
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
