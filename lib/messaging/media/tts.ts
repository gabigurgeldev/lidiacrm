/**
 * Síntese de voz (TTS) — o agente responde em áudio (migration 0222).
 *
 * O serviço é do OPERADOR, instalado ao lado do CRM (hoje o Kokoro-FastAPI,
 * imagem CPU), e fala o dialeto OpenAI: `POST /v1/audio/speech` devolvendo o
 * áudio cru. A URL vem do ambiente (`TTS_BASE_URL`), como a do canal — não de
 * tela nenhuma —, por isso não passa pela guarda anti-SSRF de URL de usuário:
 * ela recusaria, com razão, o `http://` interno da rede do Docker.
 *
 * Espelha `transcription.ts`: interface plugável, fábrica com `fetch`
 * injetável para teste, erro tipado `tts_<status>`. Diferente dela, tem
 * timeout: a síntese roda DENTRO do turno do agente, e um serviço pendurado
 * seguraria a resposta do lead para sempre.
 */

export interface SpeechProvider {
  /** Sintetiza `text` com a voz `voice`. Devolve ogg/opus pronto para nota de voz. */
  synthesize(text: string, voice: string): Promise<{ audio: Buffer; mime: string }>;
}

export interface SpeechConfig {
  baseUrl: string;
  /** id do modelo no servidor (Kokoro-FastAPI aceita `kokoro`). */
  model?: string;
  timeoutMs?: number;
}

/** O que o envio do agente precisa para falar: o provedor e o teto de texto. */
export interface VozDoEnvio {
  provider: SpeechProvider;
  /** acima disto a mensagem vai em texto (áudio de minutos ninguém escuta). */
  maxChars: number;
}

const DEFAULT_MODEL = "kokoro";
const DEFAULT_TIMEOUT_MS = 30_000;
export const MIME_DA_VOZ = "audio/ogg";

export function openAiCompatibleSpeechProvider(
  cfg: SpeechConfig,
  fetchImpl: typeof fetch = fetch,
): SpeechProvider {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  return {
    async synthesize(text, voice) {
      const res = await fetchImpl(`${base}/v1/audio/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: cfg.model ?? DEFAULT_MODEL,
          input: text,
          voice,
          // `opus` no dialeto OpenAI = contêiner ogg com codec opus: é o formato
          // de nota de voz do WhatsApp, e passa na guarda `opus-only` dos canais
          // que não convertem (`lib/channels/voz.ts`).
          response_format: "opus",
        }),
        signal: AbortSignal.timeout(cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`tts_${res.status}`);
      const audio = Buffer.from(await res.arrayBuffer());
      if (audio.length === 0) throw new Error("tts_audio_vazio");
      return { audio, mime: MIME_DA_VOZ };
    },
  };
}

/**
 * Monta a voz do envio a partir do ambiente. `null` = serviço não instalado:
 * o agente segue em texto, e quem tem o toggle ligado recebe o aviso.
 */
export function vozDoAmbiente(env: {
  TTS_BASE_URL?: string;
  TTS_TIMEOUT_MS?: number;
  TTS_MAX_CHARS?: number;
}): VozDoEnvio | null {
  const baseUrl = env.TTS_BASE_URL?.trim() ?? "";
  if (baseUrl === "") return null;
  return {
    provider: openAiCompatibleSpeechProvider({
      baseUrl,
      ...(env.TTS_TIMEOUT_MS !== undefined ? { timeoutMs: env.TTS_TIMEOUT_MS } : {}),
    }),
    maxChars: env.TTS_MAX_CHARS ?? 800,
  };
}

const URL_OU_EMAIL = /(https?:\/\/|www\.)\S+|[^\s@]+@[^\s@]+\.[^\s@]+/i;
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu;

/**
 * O texto que vira fala — ou `null` quando a mensagem deve sair em TEXTO.
 *
 * Vai em texto o que não se ouve direito: link e e-mail (ninguém copia um
 * endereço de um áudio) e mensagem longa demais. O resto perde a marcação do
 * WhatsApp (`*negrito*`, `_itálico_`, `~riscado~`, crase) e os emojis, que o
 * sintetizador leria em voz alta ou engoliria de jeito estranho.
 */
export function prepararFalaParaVoz(body: string, maxChars: number): string | null {
  if (URL_OU_EMAIL.test(body)) return null;
  const fala = body
    .replace(EMOJI, "")
    .replace(/[*_~`]+/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
  if (fala === "" || fala.length > maxChars) return null;
  return fala;
}
