/**
 * GET  /api/v1/bulk-sends — os disparos da organização.
 * POST /api/v1/bulk-sends — cria um disparo em RASCUNHO, com a lista já montada.
 *
 * ═══ Por que criar em rascunho, e não já disparando ═══
 *
 * Porque o recorte da lista É a informação que muda a decisão. O POST devolve
 * "412 vão receber · 88 fora (61 sem telefone, 19 pediram para parar)", e só
 * depois de ver isso a pessoa aperta o botão em `/start`. Criar e disparar no
 * mesmo movimento tiraria dela a única chance de olhar antes.
 *
 * ═══ O pré-voo do template roda UMA vez, aqui ═══
 *
 * `conferirDefinicao` já roda por mensagem dentro do `sendMessageHandler`, e
 * continua rodando — a Meta pode pausar a definição entre a criação e o envio.
 * Mas descobrir "falta o valor {{2}}" no destinatário nº 1 de 500, com a
 * campanha já criada, é 500 falhas idênticas achadas uma a uma. Aqui a mesma
 * conferência vira um 422 legível antes de a campanha existir.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { criarDisparo } from "@/lib/bulk-send/criar-disparo";
import { criarDisparoSchema } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = req.headers.get("x-request-id") ?? randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "bulk_sends" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bulk_sends")
    .select(
      "id, name, status, mode, provider, channel_session_id, interval_ms, scheduled_for, next_send_at, pause_reason, pause_detail, started_at, finished_at, created_at",
    )
    .eq("organization_id", authz.org.orgId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return fail("internal_error", error.message, 500, { requestId });

  const disparos = (data ?? []) as Array<{ id: string }>;

  // UMA consulta agregada para a página inteira, não um `count` por linha. É a
  // razão de não haver contador materializado em `bulk_sends`: ele teria dois
  // escritores (esta rota grava os pulados na montagem, o motor grava os
  // enviados) e divergiria em silêncio.
  const contagens = new Map<string, Record<string, number>>();
  if (disparos.length > 0) {
    const { data: linhas } = await supabase
      .from("bulk_send_recipients")
      .select("bulk_send_id, status")
      .eq("organization_id", authz.org.orgId)
      .in(
        "bulk_send_id",
        disparos.map((d) => d.id),
      );
    for (const l of (linhas ?? []) as Array<{ bulk_send_id: string; status: string }>) {
      const atual = contagens.get(l.bulk_send_id) ?? {};
      atual[l.status] = (atual[l.status] ?? 0) + 1;
      contagens.set(l.bulk_send_id, atual);
    }
  }

  return ok(
    disparos.map((d) => ({ ...d, contagens: contagens.get(d.id) ?? {} })),
    { requestId },
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = req.headers.get("x-request-id") ?? randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "bulk_sends" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  const lido = criarDisparoSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "Campos inválidos.", 422, {
      requestId,
      details: lido.error.flatten(),
    });
  }
  const entrada = lido.data;

  const supabase = await createClient();

  // A regra inteira mora em `lib/bulk-send/criar-disparo.ts`, porque o bloco de
  // fluxo "Disparo em massa" cria disparo pelo mesmo caminho. Esta rota é a
  // tradução para HTTP: cada recusa vira o status que faz sentido na API.
  const r = await criarDisparo(supabase, { organizationId: orgId, autor: { tipo: "pessoa", userId: authz.user.id } }, entrada);

  if (!r.ok) {
    const { recusa } = r;
    switch (recusa.codigo) {
      case "conexao_nao_encontrada":
        return fail("not_found", recusa.mensagem, 404, { requestId });
      case "conexao_arquivada":
        return fail("channel_archived", recusa.mensagem, 409, { requestId });
      case "modo_incompativel":
        return fail("bulk_send_mode_incompativel", recusa.mensagem, 422, { requestId });
      case "modelo_invalido":
        return fail("validation_failed", recusa.mensagem, 422, { requestId });
      case "sem_destinatario":
        return fail("bulk_send_sem_destinatario", recusa.mensagem, 422, {
          requestId,
          details: {
            fora_por_motivo: recusa.recorte.foraPorMotivo,
            repetidos: recusa.recorte.repetidos,
          },
        });
      case "lista_grande_demais":
        return fail("validation_failed", recusa.mensagem, 422, { requestId });
      case "falha_ao_gravar":
        return fail("internal_error", recusa.mensagem, 500, { requestId });
    }
  }

  await audit({
    action: "bulk_send.created",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "bulk_send",
    resourceId: r.disparoId,
    requestId,
    metadata: {
      nome: entrada.name,
      modo: entrada.mode,
      provider: r.provider,
      vao_receber: r.recorte.vaoReceber,
      fora_por_motivo: r.recorte.foraPorMotivo,
      repetidos: r.recorte.repetidos,
      intervalo_ms: entrada.interval_ms,
    },
  });

  return ok(
    {
      id: r.disparoId,
      vao_receber: r.recorte.vaoReceber,
      fora_por_motivo: r.recorte.foraPorMotivo,
      repetidos: r.recorte.repetidos,
      nao_encontrados: r.recorte.naoEncontrados,
    },
    { requestId, status: 201 },
  );
}
