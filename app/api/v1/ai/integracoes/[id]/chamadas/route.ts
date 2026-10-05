/**
 * GET /api/v1/ai/integracoes/:id/chamadas — as últimas chamadas e as últimas
 * ações propostas (manager+). Sem payload: a tabela de chamadas não guarda o
 * que o sistema respondeu, só se respondeu.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { carregarIntegracao } from "@/lib/ai/integracoes/servidor";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  if (!UUID_RX.test(id)) return fail("invalid_request", "id inválido.", 400, { requestId });
  const authz = await requireRole("manager", { requestId, resource: "ai_api_integrations" });
  if (!authz.ok) return authz.response;
  const org = authz.org.orgId;

  const admin = createAdminClient();
  const integracao = await carregarIntegracao(admin, org, id);
  if (!integracao) return fail("not_found", "Integração não encontrada.", 404, { requestId });

  const [chamadas, endpoints] = await Promise.all([
    admin
      .from("ai_api_chamadas")
      .select("id, endpoint_id, conversation_id, origem, http_status, ok, erro_codigo, duracao_ms, created_at")
      .eq("organization_id", org)
      .eq("integration_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    admin.from("ai_api_endpoints").select("id").eq("organization_id", org).eq("integration_id", id),
  ]);
  const ids = ((endpoints.data ?? []) as Array<{ id: string }>).map((e) => e.id);
  const acoes =
    ids.length === 0
      ? { data: [] }
      : await admin
          .from("ai_api_acoes_pendentes")
          .select("id, endpoint_id, conversation_id, resumo, status, resultado, erro_codigo, created_at, updated_at")
          .eq("organization_id", org)
          .in("endpoint_id", ids)
          .order("created_at", { ascending: false })
          .limit(50);

  const lista = (chamadas.data ?? []) as Array<{ ok: boolean; created_at: string }>;
  const dia = lista.filter((c) => Date.now() - new Date(c.created_at).getTime() < 86_400_000);
  return ok(
    {
      chamadas: lista,
      acoes: acoes.data ?? [],
      ultimas_24h: { total: dia.length, falhas: dia.filter((c) => !c.ok).length },
    },
    { requestId },
  );
}
