/**
 * GET /api/v1/agenda/agendamentos/{id} — um agendamento por inteiro.
 *
 * A grade carrega o MÍNIMO para desenhar; o painel de detalhe (cliente,
 * telefone, profissionais com papel, serviço, origem, conversa, lead, lembrete)
 * custa junções que não fazem sentido para cem blocos de uma semana. A leitura
 * mora em `detalheDoAgendamento` (`lib/agenda/consulta-detalhe.ts`) e devolve
 * `DetalheDoAgendamento` (`lib/agenda/contrato.ts`).
 *
 * Piso `viewer`: ver um agendamento é o menor privilégio da agenda. Client de
 * SESSÃO (a RLS vale) e mesmo assim a leitura filtra `organization_id`, que vem
 * do cookie validado — nunca da URL.
 *
 * 404 tanto para inexistente quanto para id de outra organização: dizer "existe,
 * mas não é seu" confirmaria a existência de um id alheio.
 *
 * Read-only ⇒ sem audit.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { detalheDoAgendamento } from "@/lib/agenda/consulta-detalhe";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();

  const authz = await requireRole("viewer", { requestId, resource: "agenda" });
  if (!authz.ok) return authz.response;

  const { id } = await ctx.params;
  const lido = idSchema.safeParse(id);
  if (!lido.success) {
    return fail("validation_failed", "Identificador de agendamento inválido.", 422, { requestId });
  }

  const supabase = await createClient();
  const resultado = await detalheDoAgendamento(supabase, authz.org.orgId, lido.data);
  if (!resultado.ok) {
    return resultado.codigo === "nao_encontrado"
      ? fail("not_found", "Agendamento não encontrado.", 404, { requestId })
      : fail("internal_error", resultado.motivoParaOperador, 500, { requestId });
  }
  return ok(resultado.detalhe, { requestId });
}
