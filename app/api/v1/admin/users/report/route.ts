/**
 * GET /api/v1/admin/users/report?dias=30|90 — relatório de usuários da
 * instalação: totais, papéis, organizações, série diária e inativos.
 *
 * Lê o diretório INTEIRO do Auth (não só quem tem vínculo): conta sem
 * organização também é conta, e é justamente a que ninguém vê em outra tela.
 * A conta em si é pura e mora em `lib/admin/relatorio-usuarios.ts`.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { todosOsVinculos } from "@/lib/admin/consultas-gestao";
import { varrerDiretorio } from "@/lib/admin/diretorio-auth";
import { montarRelatorio } from "@/lib/admin/relatorio-usuarios";
import { exigirPlatformAdmin } from "@/lib/admin/rota-da-plataforma";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  dias: z.enum(["7", "30", "90"]).default("30"),
});

export async function GET(req: NextRequest) {
  const requestId = randomUUID();
  const gate = await exigirPlatformAdmin(requestId);
  if (!gate.ok) return gate.response;

  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()));
  if (!parsed.success) {
    return fail("validation_failed", "Invalid query params", 400, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const dias = Number(parsed.data.dias);

  const admin = createAdminClient();
  const [diretorio, vinculos] = await Promise.all([varrerDiretorio(admin), todosOsVinculos(admin)]);

  if (!diretorio.ok) {
    return fail("upstream_unavailable", "Não consegui ler o diretório de usuários.", 503, {
      requestId,
      details: diretorio.detalhe,
    });
  }
  if ("erro" in vinculos) {
    return fail("internal_error", "Query failed", 500, { requestId, details: vinculos.erro });
  }

  const relatorio = montarRelatorio([...diretorio.usuarios.values()], vinculos, dias);

  void audit({
    action: "platform_admin.users_report_viewed",
    actorUserId: gate.ctx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    requestId,
    metadata: { dias, usuarios: relatorio.totais.usuarios },
  });

  return ok(relatorio, { requestId });
}
