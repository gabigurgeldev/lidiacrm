/**
 * GET /api/v1/admin/users/export — CSV de usuários, uma linha por pessoa.
 *
 * Aceita os mesmos filtros da listagem (`tenant_id`, `role`, `status`, `q`).
 * Nada de credencial na query: a autenticação é a sessão (cookie), como em
 * todo o painel. Audita como `platform_admin.users_exported` com a contagem —
 * é leitura em massa de dado pessoal que sai da instalação num arquivo.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { todosOsVinculos } from "@/lib/admin/consultas-gestao";
import { varrerDiretorio } from "@/lib/admin/diretorio-auth";
import { linhasDeExport, paraCsv } from "@/lib/admin/relatorio-usuarios";
import { exigirPlatformAdmin } from "@/lib/admin/rota-da-plataforma";
import { fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { ROLES } from "@/lib/schemas/team";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  tenant_id: z.string().uuid().optional(),
  role: z.enum(ROLES).optional(),
  status: z.enum(["ativo", "suspenso", "pendente"]).optional(),
  q: z.string().max(200).optional(),
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

  const linhas = linhasDeExport([...diretorio.usuarios.values()], vinculos, parsed.data);

  await audit({
    action: "platform_admin.users_exported",
    actorUserId: gate.ctx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    requestId,
    metadata: {
      filters: { ...parsed.data, q: undefined, has_q: !!parsed.data.q },
      linhas: linhas.length,
    },
  });

  const data = new Date().toISOString().slice(0, 10);
  return new NextResponse(paraCsv(linhas), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="usuarios-${data}.csv"`,
      "Cache-Control": "no-store",
      "X-Request-Id": requestId,
    },
  });
}
