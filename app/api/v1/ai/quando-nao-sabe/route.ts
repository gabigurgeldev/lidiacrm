/**
 * GET/PATCH /api/v1/ai/quando-nao-sabe — o que o agente faz quando o material
 * da empresa não responde à pergunta (`organizations.settings.ai`).
 *
 * Vale para a ORGANIZAÇÃO inteira, não para um agente: é a mesma pergunta
 * ("há gente atendendo pela Caixa de entrada?") para todos eles. A tela mostra o
 * controle dentro do editor do agente porque é lá que o dono pensa nisso, e diz
 * que a escolha vale para todos.
 *
 * Três estados, como em `guardrail-layers`: sem escolha (`null`), decide a
 * equipe configurada — e o GET devolve a contagem para a tela dizer POR QUE o
 * efetivo é o que é, em vez de mostrar uma opção marcada que ninguém escolheu.
 *
 * Escrita com admin client: a policy de `organizations` só deixa super-admin
 * escrever pela sessão (ver `settings/aniversario`). `organization_id` vem do
 * papel resolvido de fonte confiável, nunca do corpo. Merge preserva as outras
 * chaves de `settings` e de `settings.ai`.
 *
 * Papel: escolher o modo é manager+. DESLIGAR a conferência de fonte
 * (`grounding_gate`) é admin — é uma das conferências antes do envio, e as que
 * têm interruptor seguem a regra de `guardrail-layers`.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ApiError } from "@/lib/api/types";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { roleAtLeast } from "@/lib/auth/types";
import { validateRequest } from "@/lib/schemas";
import { mesclarAjustesDeFonte, orgAiSettingsSchema, salvarAjustesDeFonteSchema } from "@/lib/schemas/settings";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const PAPEIS_DE_ATENDIMENTO = ["agent", "manager", "admin"];

/** Mesma regra de `lerAjustesDeFonte` (motor, `pg`): membro agent+ com disponibilidade cadastrada. */
async function contarEquipeConfigurada(admin: ReturnType<typeof createAdminClient>, orgId: string): Promise<number> {
  const { data: disp } = await admin.from("attendant_availability").select("user_id").eq("organization_id", orgId);
  const ids = [...new Set((disp ?? []).map((d) => d.user_id as string))];
  if (ids.length === 0) return 0;
  const { data: membros } = await admin
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", orgId)
    .is("revoked_at", null)
    .in("role", PAPEIS_DE_ATENDIMENTO)
    .in("user_id", ids);
  return (membros ?? []).length;
}

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "ai_quando_nao_sabe" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  const admin = createAdminClient();
  const { data: orgRow, error } = await admin.from("organizations").select("settings").eq("id", orgId).maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });

  const ai = orgAiSettingsSchema.parse((orgRow?.settings as Record<string, unknown> | null)?.ai ?? {});
  const equipe = await contarEquipeConfigurada(admin, orgId);

  return ok(
    {
      /** `null` = a organização não escolheu; decide a equipe configurada. */
      escolha: ai.fallback_sem_fonte ?? null,
      equipe_configurada: equipe,
      conferencia_ligada: ai.grounding_gate !== false,
      pode_desligar_conferencia: roleAtLeast(authz.org.role, "admin"),
    },
    { requestId },
  );
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "ai_quando_nao_sabe" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  let input;
  try {
    input = await validateRequest(salvarAjustesDeFonteSchema, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }
  if (input.grounding_gate !== undefined && !roleAtLeast(authz.org.role, "admin")) {
    return fail("forbidden", "Só quem administra a empresa liga ou desliga a conferência de fonte.", 403, { requestId });
  }

  const admin = createAdminClient();
  const { data: orgRow, error: readErr } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", orgId)
    .maybeSingle();
  if (readErr) return fail("internal_error", readErr.message, 500, { requestId });

  const atual = (orgRow?.settings as Record<string, unknown> | null) ?? {};
  const aiNovo = mesclarAjustesDeFonte(atual.ai, input);

  const { error: updErr } = await admin
    .from("organizations")
    .update({ settings: { ...atual, ai: aiNovo } })
    .eq("id", orgId);
  if (updErr) return fail("internal_error", updErr.message, 500, { requestId });

  const antes = orgAiSettingsSchema.parse(atual.ai ?? {});
  void audit({
    action: "ai.quando_nao_sabe_changed",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "organization",
    resourceId: orgId,
    requestId,
    metadata: {
      fallback_antes: antes.fallback_sem_fonte ?? null,
      fallback_depois: (aiNovo.fallback_sem_fonte as string | undefined) ?? null,
      conferencia_antes: antes.grounding_gate !== false,
      conferencia_depois: aiNovo.grounding_gate !== false,
    },
  });

  return ok(
    {
      escolha: (aiNovo.fallback_sem_fonte as string | undefined) ?? null,
      conferencia_ligada: aiNovo.grounding_gate !== false,
    },
    { requestId },
  );
}
