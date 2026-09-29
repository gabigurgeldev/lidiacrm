/**
 * Cron `billing-conciliar` (1×/hora) — a rede de segurança do webhook do Asaas.
 *
 * O webhook é o caminho de "pagou, libera na hora". Mas webhook se perde (fila
 * pausada no Asaas depois de erros, deploy no meio da entrega, token trocado).
 * Sem isto, um cliente que pagou continuaria bloqueado até alguém perceber.
 *
 * Confere, no Asaas, as assinaturas que podem ter pagamento a registrar:
 * inadimplentes, em teste com assinatura já criada, e as que vencem em até 2
 * dias. Grava as cobranças e recalcula `pago_ate` — o mesmo caminho do webhook,
 * idempotente. Reprocessa também eventos cujo processamento falhou.
 *
 * Audita só quando mudou algo (doutrina: rodada vazia de cron não é mutação).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { cobrancaLigada, cobrancasDaAssinatura } from "@/lib/billing/asaas";
import { gravarCobranca, recalcularAssinatura } from "@/lib/billing/servico";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const LOTE = 200;

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const aceitos = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  if (aceitos.length === 0 || !provided || !aceitos.includes(provided)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  if (!cobrancaLigada()) return ok({ conferidas: 0, mudaram: 0, desligada: true }, { requestId });

  const admin = createAdminClient();
  const daquiADoisDias = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await admin
    .from("assinaturas")
    .select("organization_id, asaas_subscription_id, pago_ate, status")
    .not("asaas_subscription_id", "is", null)
    .eq("isenta", false)
    .or(`status.in.(trial,inadimplente),pago_ate.lt.${daquiADoisDias},pago_ate.is.null`)
    .limit(LOTE);
  if (error) return fail("internal_error", error.message, 500, { requestId });

  let mudaram = 0;
  let falharam = 0;
  const linhas = (data ?? []) as Array<{
    organization_id: string;
    asaas_subscription_id: string;
    pago_ate: string | null;
    status: string;
  }>;

  for (const a of linhas) {
    try {
      const pagamentos = await cobrancasDaAssinatura(a.asaas_subscription_id);
      for (const p of pagamentos) await gravarCobranca(admin, a.organization_id, p);
      const depois = await recalcularAssinatura(admin, a.organization_id);
      if (depois && (depois.pago_ate !== a.pago_ate || depois.status !== a.status)) mudaram += 1;
    } catch (e) {
      falharam += 1;
      logger.warn("[billing-conciliar] assinatura não conferida", {
        organization_id: a.organization_id,
        erro: e instanceof Error ? e.message : String(e),
        requestId,
      });
    }
  }

  const resumo = { conferidas: linhas.length, mudaram, falharam };
  if (mudaram > 0 || falharam > 0) {
    void audit({ action: "billing.conciliacao_run", bypassedRls: true, requestId, metadata: resumo });
  }
  return ok(resumo, { requestId });
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
