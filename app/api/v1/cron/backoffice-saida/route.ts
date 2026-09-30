/**
 * Cron `backoffice-saida` (a cada 5 min) — reenvio da fila para o Back Office.
 *
 * O caminho normal manda o evento logo depois da resposta do webhook ou do
 * cadastro (`lib/backoffice/saida.ts`). Isto aqui pega o que ficou: Back Office
 * fora do ar, deploy no meio, timeout. Cada linha espera o seu
 * `proxima_tentativa_em` (1, 2, 4… min, no máximo 1 h) e desiste depois de 7
 * dias — aí fica `falhou`, com o erro, para alguém olhar.
 *
 * Audita só quando mandou ou desistiu de algo (rodada vazia não é mutação).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { backofficeLigado, enviarPendentes } from "@/lib/backoffice/saida";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const aceitos = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  if (aceitos.length === 0 || !provided || !aceitos.includes(provided)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  if (!backofficeLigado()) return ok({ enviados: 0, reagendados: 0, falharam: 0, desligado: true }, { requestId });

  let resumo;
  try {
    resumo = await enviarPendentes(createAdminClient(), { limite: 200 });
  } catch (e) {
    return fail("internal_error", e instanceof Error ? e.message : "erro", 500, { requestId });
  }

  if (resumo.enviados > 0 || resumo.falharam > 0) {
    void audit({ action: "backoffice.saida_run", bypassedRls: true, requestId, metadata: { ...resumo } });
  }
  return ok(resumo, { requestId });
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
