/**
 * Quanto a TELA espera o envio de uma mensagem responder — e o que dizer
 * quando ela desiste antes.
 *
 * ─── O defeito, relatado por cliente (2026-11-19) ───────────────────────────
 *
 * "Vídeo de 30 segundos ou de 14 minutos não envia, dá erro; e tentar de novo
 * também dá erro." O envio de mídia saía com o prazo padrão do `apiClient`
 * (10 s). Do outro lado, o servidor espera o CANAL aceitar a mídia por até
 * 60 s — o canal baixa o arquivo, cifra e sobe para o WhatsApp, e vídeo
 * grande leva esse tempo. A tela cortava aos 10 s e mostrava "Erro inesperado.
 * Tente novamente." com o servidor ainda enviando. O arquivo ficava na janela
 * para tentar de novo, e cada repetição subia o vídeo outra vez e virava OUTRO
 * vídeo no WhatsApp do cliente — mensagem dobrada não se desfaz.
 *
 * ─── A regra ────────────────────────────────────────────────────────────────
 *
 * A tela espera MAIS que o servidor: o prazo do canal + folga para o resto do
 * handler (assinar a URL, gravar o desfecho). Assim quem responde é sempre o
 * servidor — "saiu" ou "falhou, por isto" —, e não o relógio da tela. O teste
 * `tests/unit/envio-de-video-pelo-inbox.test.ts` amarra este número aos prazos
 * dos canais: subir um deles sem subir este reprova.
 *
 * Texto continua no padrão curto: ele não carrega arquivo, e a espera longa
 * ali só esconderia um servidor travado.
 */

/** Prazo da tela para o envio de mídia (foto, vídeo, documento, áudio). */
export const PRAZO_DA_TELA_PARA_ENVIO_DE_MIDIA_MS = 120_000;

/** `undefined` = o padrão do `apiClient`. Só mídia ganha a espera longa. */
export function prazoDoEnvioNaTela(envio: {
  media_storage_path?: string | null;
  media_url?: string | null;
}): number | undefined {
  return envio.media_storage_path || envio.media_url ? PRAZO_DA_TELA_PARA_ENVIO_DE_MIDIA_MS : undefined;
}

/**
 * A tela desistiu SEM resposta do servidor: o prazo dela venceu, ou a conexão
 * caiu no meio. Nos dois casos o servidor pode ter enviado — e "Tente
 * novamente", que é o que o toast genérico diz, é exatamente o conselho que
 * duplica a mensagem no WhatsApp do cliente.
 */
export function envioSemResposta(err: unknown): boolean {
  if (typeof DOMException !== "undefined" && err instanceof DOMException) {
    return err.name === "AbortError" || err.name === "TimeoutError";
  }
  // `fetch` rejeita com TypeError quando a conexão cai ("Failed to fetch").
  return err instanceof TypeError;
}
