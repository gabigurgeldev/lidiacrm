/**
 * PUT /api/v1/pipelines/[id]/stages/[stageId]/tags — define as tags da coluna
 * (manager+). Aplicar uma delas no contato põe o negócio dele nesta coluna; o
 * negócio entrar na coluna aplica as tags no contato (`lib/tags/tag-no-kanban.ts`).
 *
 * Uma tag fica em UMA coluna por Kanban: já vinculada a outra, 409
 * `tag_already_linked_in_pipeline` com os conflitos; `mover: true` a traz para cá.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { respostaDeRecusa } from "@/lib/api/recusa";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { definirTagsDaColuna } from "@/lib/tags/operacoes";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string; stageId: string }>;
}

const bodySchema = z
  .object({
    tag_ids: z.array(z.string().uuid()).max(20),
    mover: z.boolean().optional(),
  })
  .strict();

export async function PUT(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id: pipelineId, stageId } = await ctx.params;
  const authz = await requireRole("manager", { requestId, resource: "crm_stage_tags" });
  if (!authz.ok) return authz.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return fail("invalid_request", "Corpo não é JSON válido.", 400, { requestId });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return fail("unprocessable_entity", "Lista de tags inválida.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const supabase = await createClient();
  try {
    const r = await definirTagsDaColuna(
      { supabase, organizationId: authz.org.orgId, userId: authz.user.id, requestId },
      pipelineId,
      stageId,
      parsed.data,
    );
    return ok(r, { requestId });
  } catch (err) {
    return respostaDeRecusa(err, requestId);
  }
}
