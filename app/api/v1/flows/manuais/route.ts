/**
 * GET /api/v1/flows/manuais — os fluxos que o botão “Ativar fluxo” pode disparar.
 *
 * São os fluxos LIGADOS cujo gatilho é `trigger.manual` (kind espelhado no
 * ponteiro pela publicação — ver `flows/[id]/publish/route.ts`). RBAC `agent`:
 * quem atende precisa escolher da lista, e a rota geral `/flows` é manager+.
 *
 * Devolve só o que o seletor usa (id, name): a lista aparece dentro do
 * atendimento e não é lugar de vazar rascunho, pasta nem configuração.
 */
import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "flows" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("flows")
    .select("id, name")
    .eq("organization_id", authz.org.orgId)
    .eq("status", "active")
    .eq("trigger_config->>kind", "manual")
    .order("name", { ascending: true });

  if (error) return fail("internal_error", error.message, 500, { requestId });
  return ok(data ?? [], { requestId });
}
