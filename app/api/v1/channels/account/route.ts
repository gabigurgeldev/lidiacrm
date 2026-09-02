/**
 * GET  /api/v1/channels/account — o que já foi conectado por credencial de conta.
 * POST /api/v1/channels/account — VALIDA a chave e devolve as instâncias dela.
 *
 * ─── Por que o POST não grava nada ──────────────────────────────────────────
 *
 * Porque uma chave de conta alcança TODAS as instâncias, e importar todas seria
 * decidir pelo operador: a conta dele pode ter números de outro cliente, de
 * teste, ou desligados. O POST valida e mostra; quem escolhe é a tela, e quem
 * grava é `POST /api/v1/channels/account/instances`.
 *
 * É a diferença que separa esta conexão das outras duas: lá a credencial JÁ é de
 * um número, então validar e gravar no mesmo passo é honesto.
 *
 * ─── O caminho é NEUTRO de propósito ────────────────────────────────────────
 *
 * `/channels/account` e não o nome do provedor: o invariante 1 da doutrina
 * (`docs/doctrine/restricao-de-canal.md`) reserva o nome a `lib/channels/`, e
 * `pnpm lint:channels` reprova arquivo fora de lá que o cite — inclusive um
 * caminho de arquivo. Esta rota delega tudo a `lib/channels/conta-de-instancias`
 * e recebe até o rótulo comercial como dado.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import {
  ACCOUNT_CHANNEL_LABEL,
  conexoesDaConta,
  validarContaDeInstancias,
} from "@/lib/channels/conta-de-instancias";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const validarSchema = z.object({
  // Sem `max` apertado: a chave é do provedor e o comprimento dela não é nosso
  // contrato. O piso existe só para recusar campo vazio antes de gastar uma ida
  // à rede.
  api_key: z.string().trim().min(8).max(500),
});

export async function GET(): Promise<NextResponse> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "channels_partner" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  const admin = createAdminClient();
  // A consulta mora no seam porque cita COLUNA de provider, e o `lint:channels`
  // reprova isso aqui — reprovou, de fato, a primeira versão desta rota.
  const conectados = await conexoesDaConta(admin, orgId);

  return ok({
    // A marca vem do SERVIDOR: a tela não pode nomear provider.
    label: ACCOUNT_CHANNEL_LABEL,
    conectados,
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "channels_partner" });
  if (!authz.ok) return authz.response;

  const parsed = validarSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("invalid_request", "api_key é obrigatória", 422, { requestId });
  }

  const admin = createAdminClient();
  const r = await validarContaDeInstancias(admin, {
    organizationId: authz.org.orgId,
    apiKey: parsed.data.api_key,
  });

  if (!r.ok) {
    // 422 e não 502: do ponto de vista de quem colou a chave, o que aconteceu é
    // "não deu para usar isto" — e a frase que acompanha diz qual dos motivos
    // foi (chave recusada, rede fora, formato irreconhecível), cada um com uma
    // ação diferente.
    return fail("invalid_request", r.motivo, 422, { requestId });
  }

  return ok({ label: ACCOUNT_CHANNEL_LABEL, instancias: r.instancias });
}
