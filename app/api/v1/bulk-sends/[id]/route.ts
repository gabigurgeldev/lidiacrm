/**
 * GET /api/v1/bulk-sends/[id] — o dossiê de um disparo.
 *
 * Os contadores saem de `bulk_send_recipients`, que é a verdade — não de coluna
 * materializada. A tela de resultado precisa responder "deu certo?" e a resposta
 * honesta é a contagem das linhas, não um número que alguém atualizou.
 *
 * Traz junto as frases: `pause_reason` vira título + próximo passo, e cada
 * motivo de pulo vira a linha em pt-BR que o operador lê. Código cru
 * (`contact_anonymized`) não chega à tela.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { fraseDaPausa, fraseDoPulo } from "@/lib/bulk-send/frases";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = req.headers.get("x-request-id") ?? randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "bulk_sends" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;
  const { id } = await ctx.params;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bulk_sends")
    .select(
      "id, name, status, mode, provider, channel_session_id, body, template_name, template_language, interval_ms, scheduled_for, next_send_at, pause_reason, pause_detail, started_at, finished_at, created_at",
    )
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!data) return fail("not_found", "Disparo não encontrado.", 404, { requestId });
  const disparo = data as Record<string, unknown>;

  const { data: linhas } = await supabase
    .from("bulk_send_recipients")
    .select("status, skip_reason")
    .eq("bulk_send_id", id)
    .eq("organization_id", orgId);

  const contagens: Record<string, number> = {};
  const foraPorMotivo: Record<string, number> = {};
  for (const l of (linhas ?? []) as Array<{ status: string; skip_reason: string | null }>) {
    contagens[l.status] = (contagens[l.status] ?? 0) + 1;
    if (l.skip_reason) foraPorMotivo[l.skip_reason] = (foraPorMotivo[l.skip_reason] ?? 0) + 1;
  }

  const restantes = (contagens.pending ?? 0) + (contagens.sending ?? 0);

  return ok(
    {
      ...disparo,
      contagens,
      fora_por_motivo: foraPorMotivo,
      restantes,
      // Previsão honesta: o intervalo REAL pode ser maior (o piso do número ou
      // do canal vence), então isto é um piso da espera, e a tela diz "pelo
      // menos". Prometer para menos é pior que não prometer.
      previsao_minima_ms: restantes * (disparo.interval_ms as number),
      pausa: fraseDaPausa(disparo.pause_reason as string | null),
      // A tela precisa do dicionário só dos motivos que ESTA campanha produziu.
      motivos: Object.fromEntries(
        Object.keys(foraPorMotivo).map((m) => [m, fraseDoPulo(m)]),
      ),
    },
    { requestId },
  );
}
