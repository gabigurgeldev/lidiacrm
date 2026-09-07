/**
 * GET/PATCH/DELETE /api/v1/flows/[id].
 *
 * O PATCH salva RASCUNHO, e o rascunho pode estar meio montado — quem recusa
 * grafo incompleto é a publicação. Salvar só o que já publica faria o operador
 * perder trabalho ao trocar de tela no meio.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, noContent, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { editarFluxoSchema } from "@/lib/flow-engine/api-schemas";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const COLUNAS =
  "id, name, folder, status, active_version_id, draft_graph, settings, created_at, updated_at";

type Contexto = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Contexto): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "flows" });
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;

  const supabase = await createClient();
  const { data } = await supabase
    .from("flows")
    .select(COLUNAS)
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .maybeSingle();
  if (data === null) return fail("not_found", "Fluxo não encontrado.", 404, { requestId });

  // A versão publicada vai junto: a tela precisa saber o que está NO AR,
  // que pode ser diferente do rascunho aberto no canvas.
  const { data: versao } = await supabase
    .from("flow_versions")
    .select("id, version_number, graph, published_at")
    .eq("organization_id", authz.org.orgId)
    .eq("flow_id", id)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  return ok({ ...(data as object), versao_publicada: versao ?? null }, { requestId });
}

export async function PATCH(req: NextRequest, ctx: Contexto): Promise<Response> {
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
  const parsed = editarFluxoSchema.safeParse(cru);
  if (!parsed.success) {
    return fail("invalid_request", "Dados inválidos.", 400, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.folder !== undefined) patch.folder = parsed.data.folder;
  if (parsed.data.draft_graph !== undefined) patch.draft_graph = parsed.data.draft_graph;
  if (parsed.data.settings !== undefined) patch.settings = parsed.data.settings;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("flows")
    .update(patch)
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .select(COLUNAS)
    .maybeSingle();

  if (error !== null) {
    if ((error as { code?: string }).code === "23505") {
      return fail("conflict", "Já existe um fluxo com esse nome.", 409, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }
  if (data === null) return fail("not_found", "Fluxo não encontrado.", 404, { requestId });

  void audit({
    action: "flow.updated",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "flow",
    resourceId: id,
    requestId,
    metadata: { campos: Object.keys(patch).filter((k) => k !== "updated_at") },
  });

  return ok(data, { requestId });
}

export async function DELETE(_req: NextRequest, ctx: Contexto): Promise<Response> {
  const requestId = randomUUID();
  // `manager`, como o resto do módulo — GET, PATCH, publish e state. Era
  // `admin`, e a divergência não tinha argumento: quem PUBLICA um fluxo põe uma
  // automação para falar com cliente e mexer no funil sozinha, o que é mais
  // grave do que apagar o rascunho dela. O gate que protege aqui não é o papel,
  // é a recusa logo abaixo — fluxo com execução VIVA não some.
  const authz = await requireRole("manager", { requestId, resource: "flows" });
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;

  const supabase = await createClient();

  // Recusa apagar fluxo com execução VIVA. O cascade levaria junto a execução e
  // o histórico dela, e uma automação sumindo no meio do caminho é exatamente o
  // desfecho que o motor inteiro existe para evitar.
  const { count } = await supabase
    .from("flow_executions")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", authz.org.orgId)
    .eq("flow_id", id)
    .in("status", ["pending", "running", "waiting", "paused"]);

  if ((count ?? 0) > 0) {
    // Frase FIXA, contagem em `details`. Interpolada, ela nunca poderia entrar
    // em `lib/i18n/dicionario.ts` — a chave só casa com texto literal — e
    // chegaria em português para quem escolheu espanhol. Com o menu de excluir
    // na lista, esta é uma das respostas que a tela realmente mostra.
    return fail(
      "conflict",
      "Este fluxo tem execuções em andamento. Pause o fluxo e espere terminarem.",
      409,
      { requestId, details: { execucoes_vivas: count ?? 0 } },
    );
  }

  const { error } = await supabase
    .from("flows")
    .delete()
    .eq("organization_id", authz.org.orgId)
    .eq("id", id);
  if (error) return fail("internal_error", error.message, 500, { requestId });

  void audit({
    action: "flow.deleted",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "flow",
    resourceId: id,
    requestId,
  });

  return noContent(requestId);
}
