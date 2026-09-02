/**
 * contact-avatars — baixa e mantém atualizada a foto de perfil dos contatos.
 *
 * POR QUE UM CRON, E NÃO NA INGESTÃO
 * O webhook de entrada precisa responder rápido: baixar e subir uma imagem no meio
 * dele atrasaria a gravação da mensagem e, num pico, faria o canal reenfileirar.
 * Aqui vale a mesma regra do resto do repo — trabalho pesado sai do caminho
 * quente e vira varredura periódica.
 *
 * POR QUE O ARQUIVO, E NÃO A URL
 * O canal devolve uma URL assinada do CDN do WhatsApp, com `oe=<expiração>` no
 * fim. Medido numa instalação real: 9 dias. Guardar a URL faria todo avatar
 * sumir da tela em pouco mais de uma semana, sem erro nenhum. Então o arquivo
 * vai para o bucket privado `whatsapp-media`, como já se faz com a mídia das
 * mensagens, e a tela pede URL assinada na hora.
 *
 * ORDEM DA VARREDURA: `avatar_updated_at nulls first` — quem nunca teve foto
 * entra antes de quem só está desatualizado. O rosto que falta incomoda mais
 * que o rosto velho.
 *
 * Auth: Bearer INTERNAL_SECRET (fail-closed), igual aos demais crons.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { sincronizarAvatar } from "@/lib/contacts/avatar-do-contato";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Contatos por invocação. Baixar imagem é I/O: cap baixo evita segurar o cron. */
const SCAN_LIMIT = 25;
/** Revisita a foto a cada 7 dias — gente troca de foto, mas não toda hora. */
const REFRESH_AFTER_DAYS = 7;
interface ContactRow {
  id: string;
  organization_id: string;
  wa_identity: string | null;
  avatar_storage_path: string | null;
}

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const accepted = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  if (accepted.length === 0 || !provided || !accepted.includes(provided)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - REFRESH_AFTER_DAYS * 86_400_000).toISOString();

  // Nunca buscados (null) OU buscados há mais de REFRESH_AFTER_DAYS.
  //
  // `is_anonymized` fora é OBRIGATÓRIO, não otimização: sem esse filtro, um
  // contato anonimizado por pedido LGPD voltaria a ser varrido no refresh
  // seguinte e o cron BAIXARIA O ROSTO DELE DE NOVO — reintroduzindo, sozinho e
  // periodicamente, o dado pessoal que acabara de ser apagado. A anonimização é
  // declarada irreversível no produto; esta linha é o que sustenta isso.
  const { data: contatos, error: queryError } = await admin
    .from("contacts")
    .select("id, organization_id, wa_identity, avatar_storage_path")
    .not("wa_identity", "is", null)
    .eq("is_anonymized", false)
    .or(`avatar_updated_at.is.null,avatar_updated_at.lt.${cutoff}`)
    .order("avatar_updated_at", { ascending: true, nullsFirst: true })
    .limit(SCAN_LIMIT);

  if (queryError) {
    logger.error("[contact-avatars] query failed", { detail: queryError.message, requestId });
    return fail("internal_error", queryError.message, 500, { requestId });
  }

  const rows = (contatos ?? []) as ContactRow[];
  let atualizados = 0;
  let semFoto = 0;
  let falhas = 0;

  // ⚠️ O CORPO DESTE LAÇO SAIU DAQUI, e não foi refatoração de gosto: nasceu um
  // SEGUNDO consumidor. Abrir uma conversa cujo contato nunca teve foto passou a
  // pedir a busca na hora, em vez de esperar esta varredura chegar nele — o que
  // leva até dez minutos, com a pessoa olhando a tela agora.
  //
  // Duas cópias divergiriam exatamente onde dói: uma delas esqueceria a corrida
  // com a anonimização (o `is_anonymized = false` no UPDATE), e o produto
  // voltaria a regravar periodicamente o rosto de quem pediu remoção.
  //
  // O comportamento deste cron não mudou em nada: mesma ordem, mesmo lote, mesma
  // contagem de saída.
  for (const c of rows) {
    const resultado = await sincronizarAvatar(admin, c, { requestId });
    if (resultado === "atualizado") atualizados++;
    else if (resultado === "sem_foto") semFoto++;
    else falhas++;
  }

  return ok(
    { scanned: rows.length, updated: atualizados, no_picture: semFoto, failed: falhas },
    { requestId },
  );
}

export const GET = handle;
export const POST = handle;
