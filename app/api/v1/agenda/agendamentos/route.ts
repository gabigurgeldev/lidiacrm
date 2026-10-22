/**
 * `/api/v1/agenda/agendamentos` — a rota, FINA.
 *
 * Ela faz três coisas e nenhuma delas é regra: autentica, valida a forma do
 * corpo, e traduz o resultado (ou o `ApiError`) em resposta HTTP. A decisão mora
 * em `_handler.ts`, e a razão é que uma ferramenta MCP não chama rota Next — não
 * há `request`, não há cookie, e a rota devolve `Response` em vez de dado. Rota
 * e tool chamam a MESMA função, e nenhuma das duas reimplementa a decisão.
 *
 * Piso `agent` nos três verbos: marcar, remarcar e cancelar são mutação, e quem
 * só olha a agenda não muda nada nela.
 *
 * ─── Contrato (migration 0245) ─────────────────────────────────────────────
 *
 *   GET    ?de&ate | dia | contact_id | lead_id | owner_user_id | professional_id
 *          [&situacao&limite] → `AgendamentoListado[]` (`lib/agenda/contrato.ts`)
 *   POST   `MarcarInput` → 201 `{ id, starts_at, ends_at, status, time_zone, professional_ids }`
 *          409 `agenda_horario_ocupado` (corrida perdida) · 422 `agenda_profissional_invalido`
 *          · 422 `agenda_profissionais_insuficientes` · 422 `agenda_horario_indisponivel`
 *   PATCH  `{ id, starts_at?, status?, notes? }` → a linha salva (409 idem no reagendar)
 *   DELETE `{ id, reason }` → a linha cancelada
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { listaAgendamentos } from "@/lib/agenda/consulta";
import { fail, ok } from "@/lib/api/wrappers";
import { ApiError } from "@/lib/api/types";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

import { alterarSchema, cancelarSchema, listarSchema, marcarSchema } from "./_schemas";
import {
  alterarAgendamentoHandler,
  cancelarAgendamentoHandler,
  marcarAgendamentoHandler,
} from "./_handler";

/**
 * GET — o que a grade desenha.
 *
 * ⚠️ RECORTE OBRIGATÓRIO, herdado de `listaAgendamentos` de propósito. Sem ele a
 * consulta varreria a agenda inteira da organização, e a recusa vem com ENSINO
 * em vez de lista vazia: vazio faria a tela dizer "nada marcado" quando a
 * verdade é que a pergunta não tinha alvo.
 *
 * O recorte que a grade usa é `de`+`ate`, em INSTANTES. A tela é semanal e
 * mensal (seis semanas), então o filtro por `dia` não a serve — e ele tem um
 * corte em UTC que, para fuso negativo, não é o dia de quem olha.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  // `viewer`: olhar a agenda é o menor privilégio desta feature.
  const authz = await requireRole("viewer", { requestId, resource: "agenda" });
  if (!authz.ok) return authz.response;
  const { org: activeOrg } = authz;

  const url = new URL(req.url);
  const parsed = listarSchema.safeParse({
    contact_id: url.searchParams.get("contact_id") ?? undefined,
    lead_id: url.searchParams.get("lead_id") ?? undefined,
    owner_user_id: url.searchParams.get("owner_user_id") ?? undefined,
    professional_id: url.searchParams.get("professional_id") ?? undefined,
    dia: url.searchParams.get("dia") ?? undefined,
    de: url.searchParams.get("de") ?? undefined,
    ate: url.searchParams.get("ate") ?? undefined,
    situacao: url.searchParams.get("situacao") ?? undefined,
    limite: url.searchParams.get("limite") ?? undefined,
  });
  if (!parsed.success) {
    return fail("validation_failed", "Consulta inválida.", 422, {
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
      requestId,
    });
  }

  const supabase = await createClient();
  const resultado = await listaAgendamentos(supabase, activeOrg.orgId, {
    contactId: parsed.data.contact_id ?? null,
    leadId: parsed.data.lead_id ?? null,
    ownerUserId: parsed.data.owner_user_id ?? null,
    professionalId: parsed.data.professional_id ?? null,
    dia: parsed.data.dia ?? null,
    de: parsed.data.de ?? null,
    ate: parsed.data.ate ?? null,
    situacao: parsed.data.situacao ?? null,
    limite: parsed.data.limite ?? 200,
  });

  if (!resultado.ok) {
    return fail(
      resultado.codigo === "sem_alvo" ? "agenda_listagem_sem_recorte" : "internal_error",
      resultado.motivoParaOperador,
      resultado.codigo === "sem_alvo" ? 422 : 500,
      { requestId },
    );
  }

  return ok(resultado.agendamentos, { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  return despachar(req, marcarSchema, marcarAgendamentoHandler, 201);
}

export async function PATCH(req: NextRequest): Promise<Response> {
  return despachar(req, alterarSchema, alterarAgendamentoHandler, 200);
}

export async function DELETE(req: NextRequest): Promise<Response> {
  return despachar(req, cancelarSchema, cancelarAgendamentoHandler, 200);
}

/**
 * O caminho comum dos três verbos: papel, forma, handler, tradução.
 *
 * Um só, e não três cópias, porque a diferença entre eles é o schema e a função
 * — o resto é idêntico, e três cópias divergiriam no primeiro ajuste.
 */
async function despachar<T>(
  req: NextRequest,
  schema: z.ZodType<T>,
  handler: (
    supabase: Awaited<ReturnType<typeof createClient>>,
    ctx: { organization_id: string; actor: { type: "user"; id: string }; requestId: string },
    input: T,
  ) => Promise<Record<string, unknown>>,
  status: 200 | 201,
): Promise<Response> {
  const requestId = randomUUID();

  const authz = await requireRole("agent", { requestId, resource: "agenda" });
  if (!authz.ok) return authz.response;
  const { org: activeOrg, user } = authz;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos.", 422, {
      details: (parsed.error as z.ZodError).flatten().fieldErrors as Record<string, unknown>,
      requestId,
    });
  }

  const supabase = await createClient();
  try {
    const resultado = await handler(
      supabase,
      {
        // A organização vem do COOKIE VALIDADO, nunca do corpo. Pela tool, ela
        // vem do contexto do agente — e é por isso que o handler a recebe como
        // parâmetro em vez de resolvê-la sozinho.
        organization_id: activeOrg.orgId,
        actor: { type: "user", id: user.id },
        requestId,
      },
      parsed.data,
    );
    return ok(resultado, { requestId, status });
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }
}
