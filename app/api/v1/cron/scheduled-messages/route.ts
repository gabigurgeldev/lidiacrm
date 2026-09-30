/**
 * GET/POST /api/v1/cron/scheduled-messages — envia as mensagens agendadas pela
 * conversa (Lembrar → "Agendar mensagem…", migration 0220).
 *
 * A regra inteira está em `lib/mensagem-agendada/motor.ts`; aqui é só relógio,
 * transporte e trilha. Roda a cada minuto no `scheduler` e no relógio HTTP
 * (`lib/relogio/tarefas.ts`) — marcar para as 14h e sair às 14h05 seria o
 * atendente dizendo ao cliente um horário que não se cumpriu.
 *
 * Auth: Bearer INTERNAL_CRON_SECRET|INTERNAL_SECRET, fail-closed.
 *
 * Auditoria: só a rodada que enviou, remarcou ou falhou alguma coisa.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { houveEfeito, rodarAgendamentos } from "@/lib/mensagem-agendada/motor";
import { portasDoSupabase } from "@/lib/mensagem-agendada/supabase";
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
    resumo = await rodarAgendamentos(portasDoSupabase(createAdminClient()), new Date());
  } catch (err) {
    const detalhe = err instanceof Error ? err.message : String(err);
    logger.error("[scheduled-messages.cron] a rodada estourou", { error: detalhe, requestId });
    return fail("internal_error", detalhe, 500, { requestId });
  }

  if (houveEfeito(resumo)) {
    void audit({
      action: "conversation.scheduled_messages_run",
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
