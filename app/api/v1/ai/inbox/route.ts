/**
 * Épico Operação Visível (F1) — central de avisos do agente.
 * GET → agent_inbox_items da org (default: abertos), mais recente primeiro.
 * Itens de plataforma (organization_id null) são do operador do sistema, não
 * do tenant — nunca entram aqui.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  status: z.enum(["open", "ack", "resolved", "all"]).default("open"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "agent_inbox_items" });
  if (!authz.ok) return authz.response;
  const { org } = authz;

  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(req.url).searchParams.entries()),
  );
  if (!parsed.success) {
    return fail("validation_failed", "Query inválida.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const { status, limit } = parsed.data;

  const admin = createAdminClient();
  let query = admin
    .from("agent_inbox_items")
    .select("id, kind, severity, title, body, ref_kind, ref_id, status, created_at")
    .eq("organization_id", org.orgId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (status !== "all") {
    query = query.eq("status", status);
  }
  const { data, error } = await query;
  if (error) {
    return fail("internal_error", "Falha ao carregar os avisos.", 500, { requestId });
  }

  // Lacunas do acervo (0245): o aviso carrega a pergunta e o estado para a tela
  // abrir "Responder e ensinar" sem uma segunda ida por item.
  const items = data ?? [];
  const idsDeLacuna = items
    .filter((i) => i.kind === "knowledge_gap" && i.ref_kind === "knowledge_gap" && i.ref_id !== null)
    .map((i) => i.ref_id as string);
  const lacunas = new Map<string, { id: string; pergunta: string; ocorrencias: number; status: string }>();
  if (idsDeLacuna.length > 0) {
    const { data: linhas } = await admin
      .from("knowledge_gaps")
      .select("id, pergunta, ocorrencias, status")
      .eq("organization_id", org.orgId)
      .in("id", idsDeLacuna);
    for (const l of linhas ?? []) lacunas.set(l.id, l);
  }
  const itemsComLacuna = items.map((i) =>
    i.ref_id !== null && lacunas.has(i.ref_id) ? { ...i, lacuna: lacunas.get(i.ref_id) } : i,
  );

  const { count: openCount } = await admin
    .from("agent_inbox_items")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", org.orgId)
    .eq("status", "open");

  return ok({ items: itemsComLacuna, open_count: openCount ?? 0 }, { requestId });
}
