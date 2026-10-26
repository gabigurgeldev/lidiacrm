/**
 * GET  /api/v1/contacts/[id]/kanbans — os Kanbans da organização (com colunas)
 *      e os negócios ABERTOS do contato (viewer+). É o que a seção "Kanbans" do
 *      painel do inbox desenha.
 * POST /api/v1/contacts/[id]/kanbans — `{ stage_id }`: coloca o contato naquela
 *      coluna (agent+). Move o negócio aberto dele naquele Kanban ou cria um;
 *      a regra mora em `lib/leads/contato-no-kanban.ts`.
 *
 * `organization_id` sai da sessão (`requireRole`), nunca do corpo.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { respostaDeRecusa } from "@/lib/api/recusa";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { colocarContatoNaColuna, lerKanbansDoContato } from "@/lib/leads/contato-no-kanban";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

const uuid = z.string().uuid();

export async function GET(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  const authz = await requireRole("viewer", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  if (!uuid.safeParse(id).success) return fail("not_found", "Contato não encontrado.", 404, { requestId });

  const supabase = await createClient();
  try {
    return ok(await lerKanbansDoContato(supabase, authz.org.orgId, id), { requestId });
  } catch (err) {
    return fail("internal_error", (err as Error).message, 500, { requestId });
  }
}

const bodySchema = z.object({ stage_id: z.string().uuid() }).strict();

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  const authz = await requireRole("agent", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  if (!uuid.safeParse(id).success) return fail("not_found", "Contato não encontrado.", 404, { requestId });

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return fail("invalid_request", "Corpo não é JSON válido.", 400, { requestId });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return fail("unprocessable_entity", "Escolha uma coluna.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const supabase = await createClient();
  try {
    const r = await colocarContatoNaColuna(
      supabase,
      { organization_id: authz.org.orgId, actor: { type: "user", id: authz.user.id }, requestId },
      { contactId: id, stageId: parsed.data.stage_id },
    );
    return ok(r, { requestId });
  } catch (err) {
    return respostaDeRecusa(err, requestId);
  }
}
