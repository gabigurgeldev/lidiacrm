/**
 * POST /api/v1/flows/[id]/state — liga e pausa o fluxo.
 *
 * Separado do publish de propósito: publicar congela o desenho, ligar aceita
 * que ele comece a mexer no funil sozinho. Juntar as duas tiraria do operador
 * a chance de conferir o que congelou antes de valer.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { trocarEstadoSchema } from "@/lib/flow-engine/api-schemas";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Contexto = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Contexto): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "flows" });
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;

  let cru: unknown = {};
  try {
    cru = await req.json();
  } catch {
    cru = {};
  }
  const parsed = trocarEstadoSchema.safeParse(cru);
  if (!parsed.success) {
    return fail("invalid_request", "Estado inválido.", 400, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const supabase = await createClient();
  const { data: fluxo } = await supabase
    .from("flows")
    .select("id, active_version_id")
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .maybeSingle();
  if (fluxo === null) return fail("not_found", "Fluxo não encontrado.", 404, { requestId });

  // Ligar sem versão publicada seria um fluxo ativo que o matcher acha e não
  // consegue armar — ativo na tela, morto na prática.
  if (parsed.data.status === "active" && (fluxo as { active_version_id: string | null }).active_version_id === null) {
    return fail("invalid_request", "Publique o fluxo antes de ligá-lo.", 422, { requestId });
  }

  const { data, error } = await supabase
    .from("flows")
    .update({ status: parsed.data.status, updated_at: new Date().toISOString() })
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .select("id, name, status, active_version_id")
    .maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });

  void audit({
    action: parsed.data.status === "active" ? "flow.activated" : "flow.paused",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "flow",
    resourceId: id,
    requestId,
  });

  return ok(data, { requestId });
}
