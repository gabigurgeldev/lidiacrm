/**
 * GET  /api/v1/tags — o catálogo de tags da organização (viewer+).
 *      `?uso=1` conta os contatos de cada tag; `?arquivadas=1` inclui arquivadas.
 * POST /api/v1/tags — cria uma tag (manager+). Atendente aplica, não cria.
 *
 * Regra em `lib/tags/operacoes.ts`; aqui só transporte. `organization_id` sai
 * da sessão — nunca do corpo.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { respostaDeRecusa } from "@/lib/api/recusa";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { criarTag, listarTags } from "@/lib/tags/operacoes";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "crm_tags" });
  if (!authz.ok) return authz.response;

  const sp = req.nextUrl.searchParams;
  const supabase = await createClient();
  try {
    const tags = await listarTags(supabase, authz.org.orgId, {
      comUso: sp.get("uso") === "1",
      incluirArquivadas: sp.get("arquivadas") === "1",
    });
    return ok(tags, { requestId });
  } catch (err) {
    return fail("internal_error", (err as Error).message, 500, { requestId });
  }
}

const criarSchema = z
  .object({
    name: z.string().min(1).max(60),
    color: z.string().max(7).optional(),
    description: z.string().max(280).nullable().optional(),
  })
  .strict();

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "crm_tags" });
  if (!authz.ok) return authz.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return fail("invalid_request", "Corpo não é JSON válido.", 400, { requestId });
  }
  const parsed = criarSchema.safeParse(json);
  if (!parsed.success) {
    return fail("unprocessable_entity", "Dê um nome à tag.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const supabase = await createClient();
  try {
    const tag = await criarTag(
      { supabase, organizationId: authz.org.orgId, userId: authz.user.id, requestId },
      parsed.data,
    );
    return ok(tag, { requestId, status: 201 });
  } catch (err) {
    return respostaDeRecusa(err, requestId);
  }
}
