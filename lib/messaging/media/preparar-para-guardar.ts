/**
 * O arquivo que a mídia do inbox GUARDA — e que o canal vai buscar no envio.
 *
 * ─── O defeito, relatado por cliente (2026-11-19) ───────────────────────────
 *
 * Vídeo pelo inbox não saía: "dá erro", de 30 segundos ou de 14 minutos, e
 * tentar de novo também dava erro. O upload guardava o vídeo como chegou, e o
 * envio pedia conversão ao transporte de QR — que atende reencodando o vídeo
 * INTEIRO em H.264 antes de mandar. Numa VPS de 2 núcleos isso leva de dezenas
 * de segundos a vários minutos, a tela desistia antes, e cada "tentar de novo"
 * subia o arquivo outra vez e empilhava OUTRO reencode no transporte — o mesmo
 * empilhamento que derrubou o WhatsApp de todas as organizações num disparo
 * com vídeo (2026-10-01, ver `video-whatsapp.ts`).
 *
 * O disparo já normalizava no upload desde então; o inbox ficou de fora.
 *
 * ─── O conserto ─────────────────────────────────────────────────────────────
 *
 * O mesmo do disparo: vídeo vira `.wa.mp4` UMA vez, aqui, e o envio sai sem
 * pedir conversão (`videoJaPronto`). Vídeo de celular comum (H.264 + AAC) só
 * troca o contêiner, instantâneo; só o que não é (HEVC de iPhone…) é
 * reencodado — uma vez.
 *
 * Não normalizou (ffmpeg ausente, arquivo estranho, resultado acima do teto)?
 * Guarda o original, como antes: o envio dele segue pedindo conversão. Pior
 * que um vídeo lento é um vídeo que nem tenta.
 */
import { extFromMime, MAX_MEDIA_BYTES } from "@/lib/messaging/media/types";
import type { MessageKind } from "@/lib/messaging/media/upload-validation";
import { paraVideoDoWhatsApp, SUFIXO_DE_VIDEO_PRONTO } from "@/lib/messaging/media/video-whatsapp";
import { transcodificarNotaDeVoz } from "@/lib/messaging/media/voice-transcode";

export interface ArquivoParaGuardar {
  buffer: Buffer;
  mime: string;
  /**
   * Com o ponto. `.wa.mp4` no vídeo pronto — é o sufixo que diz ao envio que
   * pode pular a conversão (`videoJaPronto`); `.<ext do mime>` no resto.
   */
  extensao: string;
}

export interface DepsDoPreparo {
  normalizarVideo?: typeof paraVideoDoWhatsApp;
  transcodificarVoz?: typeof transcodificarNotaDeVoz;
  /** O vídeo não foi normalizado e o original segue — para quem chama registrar. */
  aoNaoNormalizarVideo?: (motivo: string) => void;
}

export async function prepararParaGuardar(
  input: { buffer: Buffer; mime: string; kind: MessageKind },
  deps: DepsDoPreparo = {},
): Promise<ArquivoParaGuardar> {
  if (input.kind === "video") {
    const normalizar = deps.normalizarVideo ?? paraVideoDoWhatsApp;
    try {
      const pronto = await normalizar({ buffer: input.buffer });
      // O reencode quase sempre ENCOLHE o arquivo, mas não é garantia — e o
      // bucket recusa acima do teto. Aí vale mais o original que nada.
      if (pronto.buffer.length <= MAX_MEDIA_BYTES) {
        return { buffer: pronto.buffer, mime: pronto.mime, extensao: SUFIXO_DE_VIDEO_PRONTO };
      }
      deps.aoNaoNormalizarVideo?.(`video_normalizado_acima_do_teto: ${pronto.buffer.length} bytes`);
    } catch (err) {
      deps.aoNaoNormalizarVideo?.(err instanceof Error ? err.message : String(err));
    }
  }

  // Nota de voz gravada no browser sai em `webm` (o Chrome não grava ogg), e o
  // canal oficial recusa depois de aceitar — `131053 Media upload error`, que
  // culpa a URL quando o problema é o container. Converter AQUI faz todo canal
  // receber um arquivo válido. Qualquer outra coisa volta intacta.
  //
  // O vídeo que não normalizou passa por aqui também, de propósito: um `webm`
  // SÓ de áudio rotulado `video/webm` não tem fluxo de vídeo, o normalizador
  // recusa, e ele segue sendo tratado como a nota de voz que é — como antes.
  const voz = await (deps.transcodificarVoz ?? transcodificarNotaDeVoz)({
    buffer: input.buffer,
    mime: input.mime,
  });
  return { buffer: voz.buffer, mime: voz.mime, extensao: `.${extFromMime(voz.mime)}` };
}
