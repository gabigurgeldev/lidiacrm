/**
 * Cron `aniversarios` (de hora em hora) — a mensagem de parabéns automática.
 *
 * De hora em hora, e não uma vez por dia, porque cada empresa escolhe o
 * HORÁRIO e o próprio fuso: a rodada confere, para cada organização com a
 * chave ligada, se a hora local dela já chegou. O "uma vez por dia" é garantido
 * pela trava `aniversario_envios` (UNIQUE organização+dia), não pela agenda.
 *
 * O envio em si é um disparo em massa comum — ver `lib/aniversario/motor.ts`.
 *
 * Audita só a rodada que CRIOU disparo ou FALHOU (doutrina: rodada vazia de
 * cron não é mutação).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { rodarAniversarios } from "@/lib/aniversario/motor";
import { depsDeAniversario } from "@/lib/aniversario/supabase";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { organizacaoPodeOperar } from "@/lib/billing/servico";
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

  let resumo;
  try {
    resumo = await rodarAniversarios(
      depsDeAniversario(createAdminClient(), { podeOperar: organizacaoPodeOperar }),
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.error("[aniversarios.cron] rodada falhou", { error: detail, requestId });
    return fail("internal_error", detail, 500, { requestId });
  }

  if (resumo.disparos || resumo.falhas) {
    void audit({
      action: "aniversario.rodada",
      organizationId: null,
      bypassedRls: true,
      metadata: { ...resumo },
      requestId,
    });
  }

  return ok(resumo, { requestId });
}

export const GET = handle;
export const POST = handle;
