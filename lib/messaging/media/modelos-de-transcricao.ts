/**
 * Quem consegue transcrever áudio, e com que modelos — a lista que o painel de
 * provedores oferece no ponto "Ouvir o áudio do cliente".
 *
 * A transcrição fala o formato `/audio/transcriptions` da OpenAI (multipart).
 * A OpenRouter expõe o mesmo formato; Anthropic não tem API de áudio, e a da
 * Google é outra (ainda não suportada). Por isso só dois provedores aqui, e o
 * painel diz o motivo em vez de esconder os outros.
 *
 * Os modelos são SUGESTÃO, não cerca: com endereço próprio (um servidor whisper
 * local, compatível com a API da OpenAI), qualquer id vale — a validação aceita
 * id fora da lista com aviso, como faz com modelo de conversa fora do catálogo.
 */
export const PROVEDORES_DE_TRANSCRICAO = ["openai", "openrouter"] as const;
export type ProvedorDeTranscricao = (typeof PROVEDORES_DE_TRANSCRICAO)[number];

export function transcreveAudio(provider: string): provider is ProvedorDeTranscricao {
  return (PROVEDORES_DE_TRANSCRICAO as readonly string[]).includes(provider);
}

export interface ModeloDeTranscricao {
  model_id: string;
  display_name: string;
}

/**
 * Medidos na OpenRouter em 2026-10-01 com áudio OGG/Opus do WhatsApp (ver
 * `TRANSCRICAO_PELA_OPENROUTER`); na OpenAI, os três modelos públicos do
 * endpoint de transcrição.
 */
export const MODELOS_DE_TRANSCRICAO: Record<ProvedorDeTranscricao, readonly ModeloDeTranscricao[]> = {
  openai: [
    { model_id: "gpt-4o-mini-transcribe", display_name: "GPT-4o mini Transcribe (rápido e barato)" },
    { model_id: "gpt-4o-transcribe", display_name: "GPT-4o Transcribe (mais preciso)" },
    { model_id: "whisper-1", display_name: "Whisper" },
  ],
  openrouter: [
    { model_id: "openai/gpt-4o-mini-transcribe", display_name: "GPT-4o mini Transcribe (rápido e barato)" },
    { model_id: "openai/gpt-4o-transcribe", display_name: "GPT-4o Transcribe (mais preciso)" },
    { model_id: "openai/whisper-1", display_name: "Whisper" },
  ],
};

export function modeloDeTranscricaoConhecido(provider: string, modelId: string): boolean {
  return transcreveAudio(provider) && MODELOS_DE_TRANSCRICAO[provider].some((m) => m.model_id === modelId);
}

/** A explicação que o painel mostra ao lado dos provedores que não transcrevem. */
export const POR_QUE_SO_ESTES =
  "A transcrição usa o formato de áudio da OpenAI, que a OpenAI e a OpenRouter implementam. A Anthropic não tem API de áudio, e a da Google usa outro formato — ainda não suportado.";
