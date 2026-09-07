/**
 * POST /api/v1/channels/account/instances — importa as instâncias escolhidas.
 *
 * Uma linha de `channel_sessions` por instância, com o webhook já apontado para
 * esta instalação. A chave da conta vem no corpo porque ela NÃO fica guardada em
 * lugar nenhum entre o passo de validar e o de importar: guardá-la numa sessão
 * de servidor ou num cache seria criar um terceiro lugar por onde ela vaza,
 * para economizar um campo de formulário.
 *
 * ─── Por que não há DELETE aqui ────────────────────────────────────────────
 *
 * Porque excluir canal já tem dono: `DELETE /api/v1/channel-sessions/[id]`, que
 * faz o preflight de impacto (quantas conversas e mensagens seriam afetadas),
 * decide entre arquivar e apagar, apaga a credencial, ROTACIONA o
 * `webhook_path_token` — o que de fato corta a entrega — e audita. Uma segunda
 * porta teria que repetir tudo isso, e a cópia que esquecesse a rotação deixaria
 * o provedor entregando num canal "excluído".
 */
import { randomUUID } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { importarInstancias, publicBase } from "@/lib/channels/conta-de-instancias";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const importarSchema = z.object({
  api_key: z.string().trim().min(8).max(500),
  instancias: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(200),
        nome: z.string().trim().max(80).nullable().optional(),
        telefone: z.string().trim().max(40).nullable().optional(),
        situacao: z.string().trim().max(80).nullable().optional(),
        conectada: z.boolean().default(false),
        // ⚠️ Vocabulário FECHADO: é este valor que decide a regra de envio
        // (janela de 24h × anti-ban). Aceitar string livre aqui deixaria a
        // decisão nas mãos de quem monta o corpo da requisição.
        modo: z.enum(["oficial", "qr"]),
      }),
    )
    .min(1)
    .max(50),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "channels_partner" });
  if (!authz.ok) return authz.response;

  const parsed = importarSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("invalid_request", "api_key e ao menos uma instância são obrigatórias", 422, {
      requestId,
    });
  }

  const admin = createAdminClient();
  const r = await importarInstancias(admin, {
    organizationId: authz.org.orgId,
    userId: authz.user.id,
    requestId,
    apiKey: parsed.data.api_key,
    baseDoWebhook: publicBase(req).replace(/\/+$/, ""),
    instancias: parsed.data.instancias.map((i) => ({
      id: i.id,
      nome: i.nome ?? null,
      telefone: i.telefone ?? null,
      situacao: i.situacao ?? null,
      conectada: i.conectada,
      modo: i.modo,
      importada: false,
    })),
  });

  if (!r.ok) return fail("internal_error", r.motivo, 500, { requestId });

  void audit({
    action: "channel.connected",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "channel_session",
    requestId,
    metadata: {
      quantidade: r.desfechos.length,
      // Quais ficaram sem webhook, e por quê — é o que explica, meses depois,
      // por que aquele número enviava e não recebia.
      sem_webhook: r.desfechos
        .filter((d) => !d.recebendo)
        .map((d) => ({ id: d.id, motivo: d.motivo })),
    },
  });

  return ok({ importadas: r.desfechos });
}
