/**
 * PUT /api/v1/tags/[id]/colunas — em quais colunas de Kanban a tag está, no
 * máximo uma por Kanban (manager+). É o lado "da tag" do mesmo vínculo que
 * `PUT /pipelines/[id]/stages/[stageId]/tags` edita pelo lado da coluna.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { respostaDeRecusa } from "@/lib/api/recusa";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { definirColunasDaTag } from "@/lib/tags/operacoes";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ stage_ids: z.array(z.string().uuid()).max(50) }).strict();

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  const authz = await requireRole("manager", { requestId, resource: "crm_stage_tags" });
  if (!authz.ok) return authz.response;
  if (!z.string().uuid().safeParse(id).success) {
    return fail("not_found", "Tag não encontrada.", 404, { requestId });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return fail("invalid_request", "Corpo não é JSON válido.", 400, { requestId });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return fail("unprocessable_entity", "Lista de colunas inválida.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const supabase = await createClient();
  try {
    const r = await definirColunasDaTag(
      { supabase, organizationId: authz.org.orgId, userId: authz.user.id, requestId },
      id,
      parsed.data,
    );
    return ok(r, { requestId });
  } catch (err) {
    return respostaDeRecusa(err, requestId);
  }
}
