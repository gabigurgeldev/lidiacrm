/**
 * GET /api/v1/ai/coordenador/atividade?limite=50 — o diário de transições em
 * linguagem de quem opera ("Comercial → Cadastro: o agente chamou um fluxo").
 * (manager+) Só códigos e nomes: o diário nunca guarda texto do cliente.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { lerAtividade } from "@/lib/coordenador/painel";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "coordenador" });
  if (!authz.ok) return authz.response;
  const limite = Number(req.nextUrl.searchParams.get("limite") ?? 50);
  try {
    const linhas = await lerAtividade(createAdminClient(), authz.org.orgId, Number.isFinite(limite) ? limite : 50);
    return ok({ transicoes: linhas }, { requestId });
  } catch {
    return fail("internal_error", "Não foi possível carregar a atividade.", 500, { requestId });
  }
}
