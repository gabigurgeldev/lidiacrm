/**
 * PATCH /api/v1/ai/lacunas/[id] — o dono decide o que fazer com uma lacuna do
 * acervo (migration 0245): a pergunta que o cliente fez e o material do agente
 * não sabia responder.
 *
 *   { acao: "ensinar", pergunta, resposta } — o par entra no material que todo
 *     agente consulta ("Respostas ensinadas pela equipe") e a indexação é
 *     pedida. Regra em `lib/ai/lacunas/ensinar.ts`.
 *   { acao: "descartar" } — não é pergunta para o material; para de avisar.
 *
 * Papel: manager+. É o gate humano da base de conhecimento — só entra nela o
 * que alguém com responsabilidade sobre o negócio escreveu. `organization_id`
 * vem do papel resolvido na sessão, nunca do corpo. Auditado.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { descartarLacuna, ensinarLacuna } from "@/lib/ai/lacunas/ensinar";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const lacunaPatchSchema =z.discriminatedUnion("acao", [
  z
    .object({
      acao: z.literal("ensinar"),
      pergunta: z.string().trim().min(3, "Escreva a pergunta.").max(500),
      resposta: z.string().trim().min(2, "Escreva a resposta.").max(4000),
    })
    .strict(),
  z.object({ acao: z.literal("descartar") }).strict(),
]);

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  if (!UUID_RX.test(id)) return fail("invalid_request", "id inválido.", 400, { requestId });

  const authz = await requireRole("manager", { requestId, resource: "knowledge_gaps" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("invalid_request", "Body JSON inválido.", 400, { requestId });
  }
  const parsed = lacunaPatchSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", "Campos inválidos.", 422, { requestId, details: parsed.error.flatten() });
  }

  const admin = createAdminClient();

  if (parsed.data.acao === "descartar") {
    const r = await descartarLacuna(admin, { organizationId: org.orgId, lacunaId: id });
    if (!r.ok) return fail("not_found", "Pergunta não encontrada nesta empresa.", 404, { requestId });
    void audit({
      action: "ai.lacuna_descartada",
      actorUserId: user.id,
      organizationId: org.orgId,
      resourceType: "knowledge_gaps",
      resourceId: id,
      requestId,
    });
    return ok({ status: "descartada" }, { requestId });
  }

  const r = await ensinarLacuna(admin, {
    organizationId: org.orgId,
    lacunaId: id,
    userId: user.id,
    pergunta: parsed.data.pergunta,
    resposta: parsed.data.resposta,
  });
  if (!r.ok) {
    return r.motivo === "nao_encontrada"
      ? fail("not_found", r.mensagem, 404, { requestId })
      : fail("internal_error", r.mensagem, 500, { requestId });
  }
  // Metadados sem o texto: a resposta é conteúdo do negócio e já vive no material.
  void audit({
    action: "ai.lacuna_ensinada",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "knowledge_gaps",
    resourceId: id,
    requestId,
    metadata: { knowledge_source_id: r.materialId, faq_item_id: r.faqItemId },
  });
  return ok({ status: "respondida", knowledge_source_id: r.materialId }, { requestId });
}
