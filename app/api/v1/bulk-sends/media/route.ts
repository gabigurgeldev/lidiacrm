/**
 * POST /api/v1/bulk-sends/media — a imagem ou o vídeo de um disparo em massa.
 *
 * Um arquivo por DISPARO, em `whatsapp-media/<org>/disparos/<uuid>.<ext>`. Todas
 * as mensagens da campanha apontam para ele (`messages.metadata.midia_do_disparo`)
 * em vez de uma cópia por destinatário — ver o cabeçalho da migration 0219.
 *
 * A rota de mídia do inbox não serve: ela exige uma CONVERSA (o caminho é
 * `org/conversa/…`), e um disparo ainda não tem nenhuma quando o arquivo sobe.
 *
 * Os limites são os do WhatsApp — imagem até 5 MB, vídeo até 16 MB. Recusar
 * aqui é melhor que deixar subir: a recusa chegaria mensagem por mensagem, no
 * meio da campanha, falando de um arquivo que a tela aceitou.
 *
 * Mesmo papel mínimo de quem cria o disparo (`manager`).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MB = 1024 * 1024;

/** Formatos que o WhatsApp entrega como imagem/vídeo (não como documento). */
const FORMATOS: Record<string, { kind: "image" | "video"; ext: string; max: number }> = {
  "image/jpeg": { kind: "image", ext: "jpg", max: 5 * MB },
  "image/png": { kind: "image", ext: "png", max: 5 * MB },
  "image/webp": { kind: "image", ext: "webp", max: 5 * MB },
  "video/mp4": { kind: "video", ext: "mp4", max: 16 * MB },
  "video/3gpp": { kind: "video", ext: "3gp", max: 16 * MB },
};

/** A prévia na tela de criação só precisa durar a criação. */
const VALIDADE_DA_PREVIA_S = 60 * 60;

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const authz = await requireRole("manager", { requestId, resource: "bulk_sends" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return fail("validation_failed", "Campo 'file' (multipart) obrigatório.", 422, { requestId });
  }

  const formato = FORMATOS[file.type];
  if (!formato) {
    return fail(
      "unsupported_media_type",
      "Envie uma imagem (JPG, PNG ou WEBP) ou um vídeo MP4.",
      415,
      { requestId },
    );
  }
  if (file.size > formato.max) {
    return fail(
      "payload_too_large",
      formato.kind === "image" ? "A imagem precisa ter até 5 MB." : "O vídeo precisa ter até 16 MB.",
      413,
      { requestId },
    );
  }

  // Organização da SESSÃO, nunca do body — o caminho é o que `criarDisparo`
  // confere depois, e é o prefixo que o envio aceita assinar.
  const arquivoId = randomUUID();
  const caminho = `${orgId}/disparos/${arquivoId}.${formato.ext}`;
  const admin = createAdminClient();

  const { error: erroUp } = await admin.storage
    .from("whatsapp-media")
    .upload(caminho, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (erroUp) {
    logger.error("[bulk-sends/media] upload falhou", { detail: erroUp.message, requestId });
    return fail("internal_error", "Erro ao subir o arquivo.", 500, { requestId });
  }

  const { data: previa } = await admin.storage
    .from("whatsapp-media")
    .createSignedUrl(caminho, VALIDADE_DA_PREVIA_S);

  await audit({
    action: "bulk_send.media_uploaded",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "bulk_send_media",
    // `resource_id` é uuid: o id do arquivo, e o caminho inteiro vai no metadata.
    resourceId: arquivoId,
    requestId,
    metadata: { kind: formato.kind, mime: file.type, bytes: file.size, storage_path: caminho },
  });

  return ok(
    {
      storage_path: caminho,
      media_mime: file.type,
      media_kind: formato.kind,
      media_size_bytes: file.size,
      preview_url: previa?.signedUrl ?? null,
    },
    { status: 201, requestId },
  );
}
