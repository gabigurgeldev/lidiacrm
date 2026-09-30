import type { SupabaseClient } from "@supabase/supabase-js";

import { getAdapter } from "@/lib/channels";
import { phoneLookupVariants } from "@/lib/channels/phone-variants";
import {
  sessaoAtivaDaOrg,
  sessaoDaConversaDoContato,
  type SessaoAtiva,
} from "@/lib/channels/sessao-ativa";
import { logger } from "@/lib/logger";

/**
 * Buscar e guardar a foto de perfil de UM contato.
 *
 * ═══ De onde este código veio ═══
 *
 * Do corpo do laço de `app/api/v1/cron/contact-avatars/route.ts`, sem uma linha
 * de lógica nova. A extração aconteceu porque nasceu um segundo consumidor: a
 * conversa aberta pede a foto na hora, em vez de esperar o cron chegar naquele
 * contato (o que leva até dez minutos, e a pessoa está olhando a tela agora).
 *
 * Duas cópias divergiriam exatamente onde dói: uma delas esqueceria a corrida
 * com a anonimização, descrita abaixo, e o produto voltaria a regravar o rosto
 * de quem pediu remoção.
 *
 * ═══ Por que o ARQUIVO, e não a URL ═══
 *
 * O canal devolve uma URL assinada do CDN, com validade medida de ~9 dias.
 * Guardá-la faria todo avatar sumir da tela em pouco mais de uma semana, sem
 * erro nenhum. O arquivo vai para o bucket privado e aqui fica só o caminho —
 * é também o que torna a LGPD cumprível, porque só se apaga arquivo próprio.
 *
 * ═══ Este arquivo NÃO nomeia provider ═══
 *
 * Quem resolve a sessão é `lib/channels/sessao-ativa.ts`, e o que volta é um
 * identificador opaco. Aqui só se pergunta se o canal SABE buscar foto
 * (`adapter.fetchProfilePictureUrl`), nunca qual canal é — a doutrina
 * `restricao-de-canal`, que `pnpm lint:channels` sustenta.
 */

/** Foto de perfil do WhatsApp é pequena; acima disto é resposta errada. */
export const MAX_BYTES_DO_AVATAR = 2 * 1024 * 1024;

export interface ContatoParaAvatar {
  readonly id: string;
  readonly organization_id: string;
  readonly wa_identity: string | null;
  /** Endereço opaco do WhatsApp — responde mesmo com privacidade de número. */
  readonly wa_lid?: string | null;
}

/** Uma pergunta ao canal não pode segurar o lote inteiro. */
const TEMPO_MAXIMO_DA_PERGUNTA_MS = 8_000;

export type ResultadoDoAvatar = "atualizado" | "sem_foto" | "falhou";

/** `lid:123…` / `phone:+55…` → o chatId que o adapter espera. */
export function chatIdDaIdentidade(identity: string): string | null {
  if (identity.startsWith("lid:")) return `${identity.slice(4)}@lid`;
  if (identity.startsWith("phone:")) return `${identity.slice(6).replace(/\D/g, "")}@c.us`;
  return null;
}

/**
 * Os endereços pelos quais perguntar a foto, na ordem em que costumam responder.
 *
 * Medido em produção (2026-09-29), no mesmo contato e na mesma conexão:
 * `55 94 9xxxx-xxxx@c.us` (COM o nono dígito, como o CRM grava) devolveu
 * `profilePictureURL: null`; SEM o nono dígito e pelo `@lid` devolveram a foto.
 * O WhatsApp registra muito celular brasileiro sem o 9 — perguntar só pela forma
 * canônica deixava ~90% dos contatos na silhueta.
 *
 * Ordem: `@lid` (responde mesmo com privacidade de número), depois o telefone
 * SEM o nono dígito, depois COM. O primeiro que devolver foto vence.
 */
export function enderecosParaFoto(c: Pick<ContatoParaAvatar, "wa_identity" | "wa_lid">): string[] {
  const saida: string[] = [];
  const lid = (c.wa_lid ?? "").replace(/@.*$/, "").trim();
  if (lid) saida.push(`${lid}@lid`);

  const identidade = c.wa_identity ?? "";
  if (identidade.startsWith("lid:")) {
    saida.push(`${identidade.slice(4)}@lid`);
  } else if (identidade.startsWith("phone:")) {
    const variantes = phoneLookupVariants(identidade.slice(6)).map((v) => v.replace(/\D/g, ""));
    // A mais curta é a sem o nono dígito.
    variantes.sort((a, b) => a.length - b.length);
    for (const v of variantes) saida.push(`${v}@c.us`);
  }
  return [...new Set(saida)];
}

async function comTempoMaximo<T>(p: Promise<T>): Promise<T | null> {
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<null>((resolve) => {
    relogio = setTimeout(() => resolve(null), TEMPO_MAXIMO_DA_PERGUNTA_MS);
  });
  try {
    return await Promise.race([p, limite]);
  } finally {
    clearTimeout(relogio);
  }
}

export async function sincronizarAvatar(
  admin: SupabaseClient,
  contato: ContatoParaAvatar,
  contexto: { requestId?: string } = {},
  /**
   * A sessão por onde perguntar. Quando o chamador sabe a conversa do contato,
   * passa a sessão DELA — a foto de um contato tem que ser perguntada ao canal
   * em que ele fala, não a outro canal da org que nunca falou com ele. Ausente,
   * cai na sessão ativa da org (o cron, que processa contatos em lote sem uma
   * conversa em mãos).
   */
  sessaoPreferida?: SessaoAtiva,
): Promise<ResultadoDoAvatar> {
  const enderecos = enderecosParaFoto(contato);

  /**
   * Carimba mesmo sem conseguir resolver o chatId: sem isso o contato voltaria
   * em TODA rodada do cron, para sempre, batendo no canal à toa.
   *
   * ⚠️ `is_anonymized = false` no UPDATE NÃO repete o filtro de quem seleciona —
   * ele fecha uma CORRIDA. Entre escolher o contato e gravar aqui há I/O de rede
   * (canal, download, upload), e a anonimização em escopo de tenant percorre
   * centenas de contatos enquanto isto roda. Se o pedido LGPD alcançar este
   * contato no meio do caminho, sem esta cláusula o rosto voltaria para um
   * contato JÁ anonimizado — e o filtro de seleção nunca mais o escolheria para
   * corrigir. Devolve as linhas afetadas para quem chamou saber se valeu.
   */
  const carimbar = async (path: string | null): Promise<boolean> => {
    const { data: afetadas } = await admin
      .from("contacts")
      .update({
        ...(path !== null ? { avatar_storage_path: path } : {}),
        avatar_updated_at: new Date().toISOString(),
      })
      .eq("id", contato.id)
      .eq("organization_id", contato.organization_id)
      .eq("is_anonymized", false)
      .select("id");
    return (afetadas ?? []).length > 0;
  };

  if (enderecos.length === 0) {
    await carimbar(null);
    return "sem_foto";
  }

  try {
    // O canal em que o contato FALA sabe a foto dele; outro canal da org não.
    // O cron não tem a conversa em mãos, então a busca é feita aqui.
    const sessao =
      sessaoPreferida ??
      (await sessaoDaConversaDoContato(admin, contato.organization_id, contato.id)) ??
      (await sessaoAtivaDaOrg(admin, contato.organization_id));
    if (!sessao) {
      await carimbar(null);
      return "sem_foto";
    }

    // Testar a PRESENÇA do método é como se pergunta "este canal sabe fazer
    // isso?" sem perguntar qual canal é.
    const adapter = getAdapter(sessao.provider);
    if (!adapter.fetchProfilePictureUrl) {
      await carimbar(null);
      return "sem_foto";
    }

    let profilePictureURL: string | null = null;
    for (const recipient of enderecos) {
      profilePictureURL = await comTempoMaximo(
        adapter.fetchProfilePictureUrl({
          organizationId: contato.organization_id,
          sessionRef: sessao.sessionRef,
          recipient,
        }),
      );
      if (profilePictureURL) break;
    }
    if (!profilePictureURL) {
      // Contato sem foto ou com privacidade fechada: estado normal, não erro.
      await carimbar(null);
      return "sem_foto";
    }

    const img = await fetch(profilePictureURL, {
      signal: AbortSignal.timeout(TEMPO_MAXIMO_DA_PERGUNTA_MS),
    });
    if (!img.ok) {
      await carimbar(null);
      return "falhou";
    }
    const buf = Buffer.from(await img.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES_DO_AVATAR) {
      await carimbar(null);
      return "falhou";
    }

    // Caminho estável por contato: `upsert` sobrescreve a foto antiga em vez de
    // acumular um arquivo órfão por refresh.
    const path = `${contato.organization_id}/avatars/${contato.id}.jpg`;
    const { error: upErr } = await admin.storage
      .from("whatsapp-media")
      .upload(path, buf, { contentType: "image/jpeg", upsert: true });
    if (upErr) {
      await carimbar(null);
      return "falhou";
    }

    const gravou = await carimbar(path);
    if (!gravou) {
      // O contato foi anonimizado enquanto baixávamos a foto dele. O arquivo já
      // subiu, então bloquear a gravação não basta: sem isto o objeto ficaria no
      // bucket sem ponteiro nenhum — pior que o defeito original, porque
      // invisível. Devolvemos à fila de redação, o mesmo caminho que a cascata
      // usa, e o worker de limpeza remove.
      await admin.from("storage_redaction_queue").upsert(
        {
          organization_id: contato.organization_id,
          bucket: "whatsapp-media",
          object_path: path,
          status: "pending",
          attempts: 0,
          processed_at: null,
          error_message: null,
        },
        { onConflict: "bucket,object_path" },
      );
      logger.warn("[avatar-do-contato] anonimizado durante a busca; foto devolvida à fila", {
        contact_id: contato.id,
        organization_id: contato.organization_id,
        requestId: contexto.requestId,
      });
      return "sem_foto";
    }
    return "atualizado";
  } catch (err) {
    await carimbar(null);
    logger.warn("[avatar-do-contato] contato falhou", {
      contact_id: contato.id,
      detail: err instanceof Error ? err.message : String(err),
      requestId: contexto.requestId,
    });
    return "falhou";
  }
}
