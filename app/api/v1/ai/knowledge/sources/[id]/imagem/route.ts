/**
 * GET /api/v1/ai/knowledge/sources/[id]/imagem — a foto de um material do acervo.
 *
 * 302 para uma URL assinada (300 s) do bucket `whatsapp-media`. A URL desta
 * rota é usada direto como `src` de `<img>` na tela de Conhecimento: o cookie
 * de sessão vai junto por ser same-origin, e o bucket continua privado.
 *
 * O caminho NÃO é confiado ao banco. `source_metadata` é jsonb que um manager
 * escreve pela REST, e quem assina é a service role: sem
 * `caminhoDeMaterialValido`, um `blob_path` trocado faria esta rota servir
 * qualquer arquivo do bucket — de outra conversa ou de outra organização. Tudo
 * que não for uma foto do acervo DESTA organização responde 404, sem dizer qual
 * das condições falhou.
 *
 * Auth: qualquer papel da organização ativa (quem lista os materiais também vê
 * a miniatura). `organization_id` sai da sessão — nunca do path.
 */

import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { caminhoDeMaterialValido } from "@/lib/ai/rag/imagem";
import { canonizarTipoDeFonte } from "@/lib/ai/rag/tipos-de-fonte";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const VALIDADE_DA_ASSINATURA_S = 300;

/**
 * Quanto o browser guarda o redirect. MENOR que a assinatura, pelo mesmo motivo
 * da mídia das mensagens: um redirect guardado além dela aponta para URL vencida.
 */
const CACHE_DO_NAVEGADOR_S = 240;

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id: sourceId } = await ctx.params;

  const user = await loadAuthUser();
  if (!user) {
    return fail("unauthenticated", "Auth required.", 401, { requestId });
  }
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) {
    return fail("forbidden", "Nenhuma organização ativa.", 403, { requestId });
  }
  const orgId = activeOrg.orgId;

  const naoEncontrada = () => fail("not_found", "Foto não encontrada.", 404, { requestId });

  // Id que não é UUID nem chega ao banco: viraria 22P02 e um 500 enganoso.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sourceId)) {
    return naoEncontrada();
  }

  // Client de sessão: a RLS decide o acesso; o filtro de organização é a
  // segunda trava (defense-in-depth), e é o que torna o 404 de outra org certo.
  const supabase = await createClient();
  const { data: fonte, error } = await supabase
    .from("ai_knowledge_sources")
    .select("id, source_type, source_metadata")
    .eq("id", sourceId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (error) {
    logger.error("[conhecimento-imagem] leitura do material falhou", {
      detail: error.message,
      requestId,
    });
    return fail("internal_error", "Erro ao ler o material.", 500, { requestId });
  }

  const linha = fonte as {
    source_type: string;
    source_metadata: Record<string, unknown> | null;
  } | null;
  if (!linha || canonizarTipoDeFonte(linha.source_type) !== "imagem") return naoEncontrada();

  const blobPath = linha.source_metadata?.blob_path;
  if (!caminhoDeMaterialValido(blobPath, orgId)) return naoEncontrada();

  const admin = createAdminClient();
  const { data: assinada, error: erroAssinatura } = await admin.storage
    .from("whatsapp-media")
    .createSignedUrl(blobPath, VALIDADE_DA_ASSINATURA_S);

  if (erroAssinatura || !assinada?.signedUrl) {
    // Arquivo removido do bucket por fora: para quem olha, a foto não existe.
    logger.warn("[conhecimento-imagem] não assinei a foto", {
      detail: erroAssinatura?.message,
      requestId,
    });
    return naoEncontrada();
  }

  const response = NextResponse.redirect(assinada.signedUrl, 302);
  response.headers.set("X-Request-Id", requestId);
  response.headers.set("Cache-Control", `private, max-age=${CACHE_DO_NAVEGADOR_S}`);
  return response;
}
