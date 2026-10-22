/**
 * POST /api/v1/ai/knowledge/sources/imagem — uma FOTO entra no acervo.
 *
 * Multipart com três campos: `file` (jpeg/png/webp, até 5 MB), `name` e
 * `descricao`. A foto sobe para `whatsapp-media/{org}/materiais/{uuid}.{ext}`,
 * o material nasce com `source_type='imagem'`, e o indexador transforma
 * NOME + DESCRIÇÃO num trecho buscável — é pela descrição que o agente a acha,
 * porque o modelo não vê a imagem ao procurar no acervo.
 *
 * Por que o bucket do WhatsApp e uma pasta própria está escrito em
 * `lib/ai/rag/imagem.ts`; a versão curta: o envio só assina `whatsapp-media`, e
 * a foto é ativo da EMPRESA — fora das pastas por conversa que o redact da LGPD
 * apaga.
 *
 * O que esta rota NÃO confia ao navegador:
 *  - o `type` do arquivo — os primeiros bytes têm de bater com ele
 *    (`bytesConferemComOFormato`), senão um `.html` renomeado entraria como foto
 *    e seria servido por URL assinada ao WhatsApp do cliente;
 *  - a extensão do caminho — sai de `FORMATOS_DE_FOTO`, nunca de `file.name`;
 *  - a organização — sai da sessão, nunca do corpo.
 *
 * Auth: sessão por cookie, papel >= manager (o mesmo de quem envia documento).
 */

import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { temChaveDeEmbedding } from "@/lib/ai/embeddings/chave";
import {
  DESCRICAO_DA_FOTO_MAX,
  DESCRICAO_DA_FOTO_MIN,
  FORMATOS_DE_FOTO,
  TAMANHO_MAXIMO_DA_FOTO,
  bytesConferemComOFormato,
  eMimeDeFoto,
  pastaDeMateriais,
} from "@/lib/ai/rag/imagem";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BUCKET = "whatsapp-media";

const nameSchema = z.string().trim().min(2).max(120);
const descricaoSchema = z.string().trim().min(DESCRICAO_DA_FOTO_MIN).max(DESCRICAO_DA_FOTO_MAX);

/** O nome original só serve para a tela mostrar; não decide nada. */
const TAMANHO_MAXIMO_DO_NOME_DO_ARQUIVO = 255;

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const authz = await requireRole("manager", { requestId, resource: "ai_knowledge" });
  if (!authz.ok) return authz.response;
  const { user: authUser, org: activeOrg } = authz;
  const orgId = activeOrg.orgId;

  const form = await req.formData().catch(() => null);
  if (!form) {
    return fail("invalid_request", "Falha ao processar o envio da foto.", 400, { requestId });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return fail("validation_failed", "Escolha a foto que vai para o acervo.", 422, { requestId });
  }

  const nameParsed = nameSchema.safeParse(form.get("name"));
  if (!nameParsed.success) {
    return fail("validation_failed", "Dê um nome à foto (2 a 120 caracteres).", 422, { requestId });
  }
  const name = nameParsed.data;

  // A descrição é OBRIGATÓRIA: sem ela a foto seria inalcançável — o agente
  // procura por texto, e o indexador recusaria a fonte logo em seguida.
  const descricaoParsed = descricaoSchema.safeParse(form.get("descricao"));
  if (!descricaoParsed.success) {
    return fail(
      "validation_failed",
      `Descreva o que a foto mostra (${DESCRICAO_DA_FOTO_MIN} a ${DESCRICAO_DA_FOTO_MAX} caracteres). ` +
        "É por essa descrição que o agente encontra a foto.",
      422,
      { requestId },
    );
  }
  const descricao = descricaoParsed.data;

  const mime = file.type;
  if (!eMimeDeFoto(mime)) {
    return fail("unsupported_media_type", "Envie uma foto em JPG, PNG ou WEBP.", 415, {
      requestId,
    });
  }
  if (file.size > TAMANHO_MAXIMO_DA_FOTO) {
    return fail("payload_too_large", "A foto precisa ter até 5 MB.", 413, { requestId });
  }

  const conteudo = Buffer.from(await file.arrayBuffer());
  if (!bytesConferemComOFormato(new Uint8Array(conteudo), mime)) {
    return fail(
      "unsupported_media_type",
      "O arquivo não é uma foto JPG, PNG ou WEBP de verdade — só o nome dele diz que é.",
      415,
      { requestId },
    );
  }

  const admin = createAdminClient();
  const blobPath = `${pastaDeMateriais(orgId)}${randomUUID()}.${FORMATOS_DE_FOTO[mime]}`;

  const { error: erroUp } = await admin.storage
    .from(BUCKET)
    .upload(blobPath, conteudo, { contentType: mime, upsert: false });
  if (erroUp) {
    logger.error("[conhecimento-imagem] upload falhou", { detail: erroUp.message, requestId });
    return fail("internal_error", "Erro ao guardar a foto.", 500, { requestId });
  }

  const { data: ks, error: ksErr } = await admin
    .from("ai_knowledge_sources")
    .insert({
      organization_id: orgId,
      agent_id: null,
      source_type: "imagem",
      name,
      status: "ready",
      is_active: true,
      ingested_at: new Date().toISOString(),
      source_metadata: {
        blob_path: blobPath,
        mime_type: mime,
        size_bytes: conteudo.length,
        filename: file.name.slice(0, TAMANHO_MAXIMO_DO_NOME_DO_ARQUIVO),
        descricao,
        uploaded_by: authUser.id,
      },
    })
    .select("id")
    .single();

  if (ksErr || !ks) {
    // Sem a linha, ninguém aponta para o arquivo: deixá-lo no bucket seria lixo
    // que ocupa a mesma cota de 1 GB das mídias do WhatsApp.
    await admin.storage.from(BUCKET).remove([blobPath]);
    if (ksErr?.code === "23505") {
      return fail(
        "knowledge_source_name_in_use",
        `Já existe um material chamado "${name}". Escolha outro nome.`,
        409,
        { requestId },
      );
    }
    logger.error("[conhecimento-imagem] insert falhou", { detail: ksErr?.message, requestId });
    return fail("internal_error", "Erro ao registrar a foto.", 500, { requestId });
  }

  const ksId = (ks as { id: string }).id;

  // O mesmo evento dos outros materiais: é ele que o indexador consome.
  const { error: emitErr } = await admin.rpc("emit_event" as never, {
    p_event_type: "knowledge_source.updated",
    p_entity_kind: "ai_knowledge_source",
    p_entity_id: ksId,
    p_payload: { knowledge_source_id: ksId, agent_id: null, source_type: "imagem" },
    p_organization_id: orgId,
  } as never);
  if (emitErr) {
    logger.warn("[conhecimento-imagem] emit_event falhou (não bloqueia)", {
      detail: emitErr.message,
      requestId,
    });
  }

  await audit({
    action: "ai_knowledge.image_uploaded",
    actorUserId: authUser.id,
    organizationId: orgId,
    resourceType: "ai_knowledge_source",
    resourceId: ksId,
    requestId,
    metadata: { mime, bytes: conteudo.length, storage_path: blobPath, name },
  });

  const temChave = await temChaveDeEmbedding(orgId);

  return ok({ id: ksId, indexacao_habilitada: temChave }, { status: 201, requestId });
}
