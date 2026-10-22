/**
 * GET/POST /api/v1/cron/agenda-lembretes — o lembrete automático do horário
 * marcado (migration 0245).
 *
 * A regra inteira está em `lib/agenda/lembrete/motor.ts`; aqui é só relógio,
 * transporte e trilha. Roda a cada 10 minutos no `scheduler`: o lembrete é de
 * horas ou dias antes, e dez minutos de atraso não mudam nada para quem o lê.
 *
 * O lembrete NÃO envia: ele enfileira em `conversation_scheduled_messages`, e
 * quem envia é o cron `scheduled-messages` (janela do número, throttle,
 * contato bloqueado, aviso de falha). Nenhum caminho de envio novo.
 *
 * Auth: Bearer INTERNAL_CRON_SECRET|INTERNAL_SECRET, fail-closed.
 *
 * Auditoria: só a rodada que enfileirou, pulou ou falhou alguma coisa.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { houveEfeito, rodarLembretes } from "@/lib/agenda/lembrete/motor";
import { portasDoLembrete } from "@/lib/agenda/lembrete/supabase";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const accepted = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  if (accepted.length === 0 || !provided || !accepted.includes(provided)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  let resumo;
  try {
    resumo = await rodarLembretes(portasDoLembrete(createAdminClient()), new Date());
  } catch (err) {
    const detalhe = err instanceof Error ? err.message : String(err);
    logger.error("[agenda-lembretes.cron] a rodada estourou", { error: detalhe, requestId });
    return fail("internal_error", detalhe, 500, { requestId });
  }

  if (houveEfeito(resumo)) {
    void audit({
      action: "agenda.lembrete_rodada",
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
