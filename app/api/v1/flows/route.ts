/**
 * GET/POST /api/v1/flows — lista e cria fluxos do Flow Engine.
 *
 * RBAC manager+, como as automações: montar um fluxo é montar algo que fala com
 * cliente e mexe no funil sozinho.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { criarFluxoSchema } from "@/lib/flow-engine/api-schemas";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const COLUNAS =
  "id, name, folder, status, active_version_id, settings, created_at, updated_at";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "flows" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("flows")
    .select(COLUNAS)
    .eq("organization_id", authz.org.orgId)
    .order("updated_at", { ascending: false });

  if (error) return fail("internal_error", error.message, 500, { requestId });
  return ok(data ?? [], { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "flows" });
  if (!authz.ok) return authz.response;

  let cru: unknown = {};
  try {
    cru = await req.json();
  } catch {
    cru = {};
  }
  const parsed = criarFluxoSchema.safeParse(cru);
  if (!parsed.success) {
    return fail("invalid_request", "Dados inválidos.", 400, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const supabase = await createClient();
  const { data: criado, error } = await supabase
    .from("flows")
    .insert({
      organization_id: authz.org.orgId,
      name: parsed.data.name,
      folder: parsed.data.folder ?? null,
      // Nasce PAUSADO — nunca ativo. Um fluxo criado já disparando faria a
      // primeira automação de alguém rodar antes de a pessoa terminar de montar.
      status: "draft",
      created_by_user_id: authz.user.id,
    })
    .select(COLUNAS)
    .single();

  if (error !== null) {
    // `uniq_flows_org_name` — nome repetido vira 409 legível, não 500.
    if ((error as { code?: string }).code === "23505") {
      return fail("conflict", "Já existe um fluxo com esse nome.", 409, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }

  void audit({
    action: "flow.created",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "flow",
    resourceId: (criado as { id: string }).id,
    requestId,
    metadata: { name: parsed.data.name },
  });

  return ok(criado, { requestId, status: 201 });
}
