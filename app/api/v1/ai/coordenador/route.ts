/**
 * GET  /api/v1/ai/coordenador — o painel: política da organização em vigor,
 *      histórico de versões, agentes e fluxos disponíveis, resumo de 24h.
 *      (manager+)
 * POST /api/v1/ai/coordenador — publica uma versão NOVA da política da
 *      organização e move o ponteiro. (admin) Audita
 *      `coordenador.politica_publicada`.
 *
 * A organização vem da sessão (`requireRole`), nunca do corpo. O corpo é a
 * política inteira, validada pelo MESMO `politicaSchema` que a tela usa — o
 * que a tela aceita e o que o servidor grava não divergem.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { lerPainel, publicarPolitica } from "@/lib/coordenador/painel";
import { politicaSchema } from "@/lib/coordenador/politica/schema";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "coordenador" });
  if (!authz.ok) return authz.response;
  try {
    return ok(await lerPainel(createAdminClient(), authz.org.orgId), { requestId });
  } catch {
    return fail("internal_error", "Não foi possível carregar o coordenador.", 500, { requestId });
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "coordenador" });
  if (!authz.ok) return authz.response;

  const corpo = await req.json().catch(() => null);
  const lido = politicaSchema.safeParse(corpo);
  if (!lido.success) {
    return fail("validation_failed", "A política tem campos inválidos.", 422, {
      requestId,
      details: lido.error.flatten(),
    });
  }
  // Esta rota publica a política da ORGANIZAÇÃO. Número com política própria
  // não se edita por aqui (ver o cabeçalho de lib/coordenador/painel.ts).
  if (lido.data.channel_session_id !== null) {
    return fail("invalid_request", "Esta tela publica a política da organização inteira.", 422, { requestId });
  }

  const r = await publicarPolitica(createAdminClient(), {
    orgId: authz.org.orgId,
    userId: authz.user.id,
    politica: lido.data,
  });
  if (!r.ok) {
    return r.motivo === "destino_de_outra_organizacao"
      ? fail("invalid_request", "Um dos agentes ou fluxos escolhidos não é desta organização.", 422, { requestId })
      : fail("internal_error", "Não foi possível publicar a política.", 500, { requestId });
  }

  void audit({
    action: "coordenador.politica_publicada",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "coordenador",
    resourceId: r.versaoId,
    requestId,
    metadata: { numero: r.numero, modo: lido.data.modo, destinos: lido.data.destinos.length },
  });

  return ok({ versao_id: r.versaoId, numero: r.numero }, { requestId, status: 201 });
}
