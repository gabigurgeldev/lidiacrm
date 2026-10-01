/**
 * Síntese de voz (TTS) — o agente responde em áudio (migration 0222).
 *
 * Dois serviços falam o mesmo dialeto OpenAI (`POST /v1/audio/speech`
 * devolvendo o áudio cru), e a regra de qual vale é `servicoDeVoz`
 * (`lib/ai/voz/vozes.ts`):
 *
 *  - o do OPERADOR, instalado ao lado do CRM (o Kokoro-FastAPI, imagem CPU),
 *    pela URL do ambiente (`TTS_BASE_URL`) — não de tela nenhuma, por isso não
 *    passa pela guarda anti-SSRF de URL de usuário: ela recusaria, com razão, o
 *    `http://` interno da rede do Docker;
 *  - o Grok pela OpenRouter, com a chave da própria organização
 *    (`vozPelaOpenRouter`). Não roda nada na VPS: medido em 2026-10-01, oito
 *    falas simultâneas ficaram prontas em ~3s, contra ~9s CADA no Kokoro de uma
 *    VPS de 2 núcleos — que, com 8 turnos em paralelo, empurrava a última fala
 *    para além do timeout e ainda disputava CPU com o WAHA.
 *
 * Espelha `transcription.ts`: interface plugável, fábrica com `fetch`
 * injetável para teste, erro tipado `tts_<status>`. Diferente dela, tem
 * timeout: a síntese roda DENTRO do turno do agente, e um serviço pendurado
 * seguraria a resposta do lead para sempre.
 */
import type { ServicoDeVoz } from "@/lib/ai/voz/vozes";

export interface SpeechProvider {
  /**
   * Sintetiza `text` com a voz `voice`. O `mime` diz o formato devolvido —
   * ogg/opus no Kokoro, mp3 no Grok —; quem envia converte para nota de voz
   * quando precisa (`paraNotaDeVoz`).
   */
  synthesize(text: string, voice: string): Promise<{ audio: Buffer; mime: string }>;
}

export interface SpeechConfig {
  baseUrl: string;
  /** id do modelo no servidor (Kokoro-FastAPI aceita `kokoro`). */
  model?: string;
  timeoutMs?: number;
  /** Bearer do serviço. O Kokoro local não pede; a OpenRouter pede. */
  apiKey?: string;
  /** `opus` (padrão) = ogg/opus; o Grok só entrega `mp3` ou `pcm`. */
  responseFormat?: "opus" | "mp3";
}

/** O que o envio do agente precisa para falar: o provedor e o teto de texto. */
export interface VozDoEnvio {
  provider: SpeechProvider;
  /** De qual catálogo a voz tem de vir (`vozParaOServico`). */
  servico: ServicoDeVoz;
  /** acima disto a mensagem vai em texto (áudio de minutos ninguém escuta). */
  maxChars: number;
}

const DEFAULT_MODEL = "kokoro";
const DEFAULT_TIMEOUT_MS = 30_000;
export const MIME_DA_VOZ = "audio/ogg";
const MIME_DO_FORMATO = { opus: MIME_DA_VOZ, mp3: "audio/mpeg" } as const;

/** O Grok pela OpenRouter — a mesma base de `TRANSCRICAO_PELA_OPENROUTER`. */
export const VOZ_PELA_OPENROUTER = {
  baseUrl: "https://openrouter.ai/api",
  model: "x-ai/grok-voice-tts-1.0",
  responseFormat: "mp3",
} as const;

export function openAiCompatibleSpeechProvider(
  cfg: SpeechConfig,
  fetchImpl: typeof fetch = fetch,
): SpeechProvider {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const formato = cfg.responseFormat ?? "opus";
  return {
    async synthesize(text, voice) {
      const res = await fetchImpl(`${base}/v1/audio/speech`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: cfg.model ?? DEFAULT_MODEL,
          input: text,
          voice,
          // `opus` no dialeto OpenAI = contêiner ogg com codec opus: é o formato
          // de nota de voz do WhatsApp, e passa na guarda `opus-only` dos canais
          // que não convertem (`lib/channels/voz.ts`). Quem só entrega mp3 (o
          // Grok) é convertido depois, no envio.
          response_format: formato,
        }),
        signal: AbortSignal.timeout(cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`tts_${res.status}`);
      const audio = Buffer.from(await res.arrayBuffer());
      if (audio.length === 0) throw new Error("tts_audio_vazio");
      return { audio, mime: MIME_DO_FORMATO[formato] };
    },
  };
}

/**
 * Monta a voz do envio a partir do ambiente. `null` = serviço não instalado:
 * a organização ainda pode falar pela OpenRouter (`vozPelaOpenRouter`).
 */
export function vozDoAmbiente(env: {
  TTS_BASE_URL?: string;
  TTS_TIMEOUT_MS?: number;
  TTS_MAX_CHARS?: number;
}): VozDoEnvio | null {
  const baseUrl = env.TTS_BASE_URL?.trim() ?? "";
  if (baseUrl === "") return null;
  return {
    servico: "kokoro",
    provider: openAiCompatibleSpeechProvider({
      baseUrl,
      ...(env.TTS_TIMEOUT_MS !== undefined ? { timeoutMs: env.TTS_TIMEOUT_MS } : {}),
    }),
    maxChars: env.TTS_MAX_CHARS ?? 800,
  };
}

/** A voz pelo Grok, com a chave da OpenRouter da organização. */
export function vozPelaOpenRouter(
  apiKey: string,
  env: { TTS_TIMEOUT_MS?: number; TTS_MAX_CHARS?: number },
  fetchImpl: typeof fetch = fetch,
): VozDoEnvio {
  return {
    servico: "grok",
    provider: openAiCompatibleSpeechProvider(
      {
        ...VOZ_PELA_OPENROUTER,
        apiKey,
        ...(env.TTS_TIMEOUT_MS !== undefined ? { timeoutMs: env.TTS_TIMEOUT_MS } : {}),
      },
      fetchImpl,
    ),
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
