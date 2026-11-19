/**
 * POST /api/v1/conversations/[id]/media — upload outbound (multipart).
 * Storage-first: sobe pro bucket whatsapp-media; o envio da mensagem
 * referencia o storage_path (o WAHA recebe signed URL, nunca base64).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { logger } from "@/lib/logger";
import { prepararParaGuardar } from "@/lib/messaging/media/preparar-para-guardar";
import { MAX_MEDIA_BYTES } from "@/lib/messaging/media/types";
import { validateOutboundMedia } from "@/lib/messaging/media/upload-validation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
// ffmpeg (vídeo e nota de voz) roda por `spawn`: precisa do runtime Node.
export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id: conversationId } = await ctx.params;
  const supabase = await createClient();

  // spec 13 §4: escrita é agent+ (viewer é read-only). Esta rota era a ÚNICA de
  // escrita em conversations/[id]/* sem o gate — e como a policy de SELECT deixa
  // o viewer enxergar toda conversa da org, o papel mais fraco do tenant tinha
  // escrita irrestrita no bucket (50 MB por arquivo, com service_role). A irmã
  // claim/route.ts:35 é o modelo literal.
  const authz = await requireRole("agent", { requestId, resource: "conversation_media" });
  if (!authz.ok) return authz.response;
  const user = authz.user;
  const authUser = await loadAuthUser();
  const activeOrg = authUser ? await resolveActiveOrg(authUser) : null;
  if (!activeOrg) return fail("no_active_org", "No active organization.", 403, { requestId });

  // RLS + filtro explícito: a conversa precisa ser da org ativa.
  const { data: conv, error: convErr } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();
  if (convErr) return fail("internal_error", "Erro ao validar conversa.", 500, { requestId });
  if (!conv) return fail("not_found", "Conversa não encontrada.", 404, { requestId });

  // Guard de DoS: rejeita pelo Content-Length declarado ANTES de bufferizar
  // o corpo inteiro. 1MB de slack pro overhead de multipart; o check
  // autoritativo continua o file.size pós-parse (Content-Length pode mentir).
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_MEDIA_BYTES + 1_048_576) {
    return fail("payload_too_large", "Arquivo acima de 50MB.", 413, { requestId });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return fail("validation_failed", "Campo 'file' (multipart) obrigatório.", 422, { requestId });
  }

  const mime = file.type || "application/octet-stream";
  const verdict = validateOutboundMedia(mime, file.size);
  if (!verdict.ok) {
    const status = verdict.code === "payload_too_large" ? 413 : verdict.code === "unsupported_media_type" ? 415 : 422;
    return fail(verdict.code, verdict.message, status, { requestId });
  }

  const bruto = Buffer.from(await file.arrayBuffer());

  // O formato que o canal toca, UMA vez, aqui — e não a cada envio:
  //   - vídeo vira `.wa.mp4` e sai sem pedir ao WAHA que o reencode inteiro
  //     (era o que fazia vídeo do inbox "dar erro" e duplicar na repetição);
  //   - nota de voz `webm` vira `ogg`, que todo canal aceita.
  // Falha devolve o original: o canal que converte sozinho segue como sempre.
  // Ver o cabeçalho de `lib/messaging/media/preparar-para-guardar.ts`.
  const preparado = await prepararParaGuardar(
    { buffer: bruto, mime, kind: verdict.kind },
    {
      aoNaoNormalizarVideo: (motivo) =>
        logger.warn("[conversations.media] não normalizei o vídeo; guardo o original", {
          detail: motivo,
          requestId,
        }),
    },
  );
  const mimeFinal = preparado.mime;
  const buffer = preparado.buffer;

  const storagePath = `${activeOrg.orgId}/${conversationId}/out-${randomUUID()}${preparado.extensao}`;
  const admin = createAdminClient();
  const { error: upErr } = await admin.storage
    .from("whatsapp-media")
    .upload(storagePath, buffer, { contentType: mimeFinal, upsert: false });
  if (upErr) {
    logger.error("[conversations.media] upload failed", { detail: upErr.message, requestId });
    return fail("internal_error", "Erro ao subir o arquivo.", 500, { requestId });
  }

  return ok(
    {
      storage_path: storagePath,
      // O mime e o tamanho do arquivo QUE FOI GUARDADO, não os que chegaram.
      // Devolver o original seria mandar o canal buscar um `webm` que já não
      // existe — o mesmo defeito, um passo adiante.
      media_mime: mimeFinal,
      media_size_bytes: buffer.length,
      kind: verdict.kind,
    },
    { requestId },
  );
}
