/**
 * A guarda de FORMATO de nota de voz — capability-aware, sem nome de provider.
 *
 * ─── O defeito que ela fecha ────────────────────────────────────────────────
 *
 * A nota de voz sai do browser em `webm` (o Chrome não grava ogg) e é convertida
 * para ogg/opus no upload (`lib/messaging/media/voice-transcode.ts`). Quando essa
 * conversão NÃO acontece — ffmpeg ausente no servidor, ou um áudio já anexado num
 * contêiner que ninguém converte — o `webm` seguia até o canal, e o canal
 * `opus-only` (Meta, Stevo oficial, Zernio: eles NÃO convertem) recusava a
 * ENTREGA depois de aceitar o envio, com um erro que culpa a URL:
 *
 *   131053 — Media upload error — ...supported format.
 *
 * O operador via "falhou" numa nota de voz que gravou normalmente, sem nada
 * dizendo o motivo real. Falhar AQUI, ANTES de sair, troca esse erro críptico por
 * um acionável — e evita a falha-em-verde de mandar `webm` e a plataforma recusar
 * a entrega num passo que ninguém observa.
 *
 * ─── Por que capability, e não `if (provider === ...)` ──────────────────────
 *
 * Quem converte sozinho (WAHA Plus, `voiceNote: "server-convert"`) passa reto —
 * mandar `webm` para ele é o comportamento certo, ele resolve. A pergunta é "este
 * canal converte?", que a capability responde, e não "quem é este canal?", que o
 * invariante 1 de `docs/doctrine/restricao-de-canal.md` proíbe a feature de fazer.
 */
import type { ChannelCapabilities } from "./types";

/** Contêineres que o WhatsApp aceita como nota de voz (codec opus). */
export function ehVozOpus(mime: string): boolean {
  const base = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  return base === "audio/ogg" || base === "audio/opus";
}

/**
 * Por que este áudio NÃO pode virar nota de voz neste canal — frase pronta pra
 * tela, ou `null` quando pode sair.
 *
 * Só morde `kind === "audio"` num canal `opus-only`: os demais ou convertem
 * sozinhos, ou não têm janela de formato. Fora dessas condições devolve `null` e
 * o envio segue como sempre.
 */
export function motivoDeVozNaoEnviavel(
  caps: ChannelCapabilities,
  kind: string,
  mime: string,
): string | null {
  if (kind !== "audio") return null;
  if (caps.voiceNote !== "opus-only") return null;
  if (ehVozOpus(mime)) return null;
  return "voice_format_incompativel: este canal exige a nota de voz em ogg/opus e a conversão não aconteceu — verifique se o ffmpeg está disponível no servidor.";
}
