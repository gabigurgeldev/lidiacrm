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
import { recusaDeModo } from "@/lib/bulk-send/modo";
import {
  montarRecortePorIds,
  montarRecortePorTags,
  MAX_DESTINATARIOS,
  type Recorte,
} from "@/lib/bulk-send/montagem";
import { ARCHIVED_AT, queryTolerantToMissingArchived } from "@/lib/channels/archived";
import type { ChannelProvider } from "@/lib/channels/capabilities";
import { conferirDefinicao } from "@/lib/channels/conferir-definicao";
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

  // ─── A conexão, e o modo que ELA permite ────────────────────────────────────
  const select = (comArchived: boolean) =>
    `id, provider, status${comArchived ? `, ${ARCHIVED_AT}` : ""}`;
  const { data: sessaoRaw } = await queryTolerantToMissingArchived(
    () =>
      supabase
        .from("channel_sessions")
        .select(select(true))
        .eq("id", entrada.channel_session_id)
        .eq("organization_id", orgId)
        .maybeSingle(),
    () =>
      supabase
        .from("channel_sessions")
        .select(select(false))
        .eq("id", entrada.channel_session_id)
        .eq("organization_id", orgId)
        .maybeSingle(),
  );
  const sessao = sessaoRaw as unknown as
    | { id: string; provider: ChannelProvider; status: string; archived_at?: string | null }
    | null;

  if (!sessao) {
    return fail("not_found", "Conexão não encontrada nesta organização.", 404, { requestId });
  }
  if (sessao.archived_at) {
    return fail(
      "channel_archived",
      "Essa conexão foi excluída da Central de Conexões. Escolha outra.",
      409,
      { requestId },
    );
  }

  // O modo é consequência da conexão, nunca uma segunda pergunta — ver
  // `lib/bulk-send/modo.ts`. A tela nem oferece a combinação impossível; este
  // gate é para quem chegou pela API.
  const recusa = recusaDeModo(sessao.provider, entrada.mode);
  if (recusa) {
    return fail("bulk_send_mode_incompativel", recusa, 422, { requestId });
  }

  // ─── Pré-voo do contrato do modelo, uma vez ────────────────────────────────
  if (entrada.mode === "template") {
    try {
      await conferirDefinicao(supabase, {
        organizationId: orgId,
        channelSessionId: entrada.channel_session_id,
        name: entrada.template_name ?? "",
        language: entrada.template_language ?? "",
        values: entrada.template_values,
      });
    } catch (err) {
      // As frases de `conferirDefinicao` já são acionáveis em pt-BR
      // ("X espera 2 valor(es) — falta: body_2"). Repassar verbatim.
      return fail(
        "validation_failed",
        err instanceof Error ? err.message : "O modelo escolhido não pôde ser conferido.",
        422,
        { requestId },
      );
    }
  }

  // ─── O recorte da lista ────────────────────────────────────────────────────
  let recorte: Recorte;
  try {
    recorte =
      entrada.audiencia.kind === "tags"
        ? await montarRecortePorTags(supabase, orgId, entrada.audiencia.tags)
        : await montarRecortePorIds(supabase, orgId, entrada.audiencia.contact_ids);
  } catch (err) {
    return fail("internal_error", err instanceof Error ? err.message : "falha ao montar a lista", 500, {
      requestId,
    });
  }

  if (recorte.vaoReceber === 0) {
    // Campanha que não fala com ninguém não nasce: ela viraria um disparo
    // "concluído" com zero enviados, e isso se lê como sucesso.
    return fail(
      "bulk_send_sem_destinatario",
      "Nenhum contato desta lista pode receber a mensagem. Confira os motivos e escolha outra lista.",
      422,
      { requestId, details: { fora_por_motivo: recorte.foraPorMotivo, repetidos: recorte.repetidos } },
    );
  }
  if (recorte.vaoReceber > MAX_DESTINATARIOS) {
    return fail(
      "validation_failed",
      `Máximo de ${MAX_DESTINATARIOS} destinatários por disparo — divida a lista.`,
      422,
      { requestId },
    );
  }

  // ─── Cria o disparo e a lista ──────────────────────────────────────────────
  const { data: criado, error: erroDisparo } = await supabase
    .from("bulk_sends")
    .insert({
      organization_id: orgId,
      name: entrada.name,
      status: "draft",
      channel_session_id: entrada.channel_session_id,
      // Cópia congelada: re-parear o número depois não muda o que esta campanha é.
      provider: sessao.provider,
      mode: entrada.mode,
      body: entrada.body ?? null,
      template_name: entrada.template_name ?? null,
      template_language: entrada.template_language ?? null,
      template_values: entrada.template_values,
      interval_ms: entrada.interval_ms,
      scheduled_for: entrada.scheduled_for ?? null,
      created_by_user_id: authz.user.id,
    })
    .select("id")
    .single();

  if (erroDisparo || !criado) {
    return fail("internal_error", erroDisparo?.message ?? "bulk_send_insert_failed", 500, {
      requestId,
    });
  }
  const disparoId = (criado as { id: string }).id;

  const { error: erroLinhas } = await supabase.from("bulk_send_recipients").insert(
    recorte.linhas.map((l) => ({
      organization_id: orgId,
      bulk_send_id: disparoId,
      contact_id: l.contact_id,
      status: l.status,
      skip_reason: l.skip_reason,
    })),
  );
  if (erroLinhas) {
    // O disparo sem lista é lixo que confunde a tela; apagar aqui é seguro
    // porque ele nasceu neste request e ninguém mais o viu.
    await supabase.from("bulk_sends").delete().eq("id", disparoId).eq("organization_id", orgId);
    return fail("internal_error", erroLinhas.message, 500, { requestId });
  }

  await audit({
    action: "bulk_send.created",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "bulk_send",
    resourceId: disparoId,
    requestId,
    metadata: {
      nome: entrada.name,
      modo: entrada.mode,
      provider: sessao.provider,
      vao_receber: recorte.vaoReceber,
      fora_por_motivo: recorte.foraPorMotivo,
      repetidos: recorte.repetidos,
      intervalo_ms: entrada.interval_ms,
    },
  });

  return ok(
    {
      id: disparoId,
      vao_receber: recorte.vaoReceber,
      fora_por_motivo: recorte.foraPorMotivo,
      repetidos: recorte.repetidos,
      nao_encontrados: recorte.naoEncontrados,
    },
    { requestId, status: 201 },
  );
}
