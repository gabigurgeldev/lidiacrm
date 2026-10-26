/**
 * PATCH  /api/v1/tags/[id] — renomear (propaga para contatos, negócios e
 *        conversas), trocar cor/descrição, arquivar ou reativar (manager+).
 *        Renomear para o nome de outra tag responde 409 `tag_merge_required`;
 *        reenviar com `fundir: true` junta as duas.
 * DELETE /api/v1/tags/[id] — ARQUIVA (manager+). Some do seletor; quem já tem a
 *        tag continua com ela — apagar dos contatos seria perder marcação que
 *        alguém pôs à mão.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { respostaDeRecusa } from "@/lib/api/recusa";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { atualizarTag } from "@/lib/tags/operacoes";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

const patchSchema = z
  .object({
    name: z.string().min(1).max(60).optional(),
    color: z.string().max(7).optional(),
    description: z.string().max(280).nullable().optional(),
    is_archived: z.boolean().optional(),
    fundir: z.boolean().optional(),
  })
  .strict();

async function aplicar(
  requestId: string,
  id: string,
  input: z.infer<typeof patchSchema>,
): Promise<Response> {
  const authz = await requireRole("manager", { requestId, resource: "crm_tags" });
  if (!authz.ok) return authz.response;
  if (!z.string().uuid().safeParse(id).success) {
    return fail("not_found", "Tag não encontrada.", 404, { requestId });
  }

  const supabase = await createClient();
  try {
    const r = await atualizarTag(
      {
        supabase,
        // Só para `fn_renomear_tag` (revogada de authenticated); a org vai
        // explícita, resolvida da sessão acima.
        admin: createAdminClient(),
        organizationId: authz.org.orgId,
        userId: authz.user.id,
        requestId,
      },
      id,
      input,
    );
    return ok(r, { requestId });
  } catch (err) {
    return respostaDeRecusa(err, requestId);
  }
}

export async function PATCH(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return fail("invalid_request", "Corpo não é JSON válido.", 400, { requestId });
  }
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return fail("unprocessable_entity", "Dados inválidos.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  return aplicar(requestId, id, parsed.data);
}

export async function DELETE(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  return aplicar(requestId, id, { is_archived: true });
}
