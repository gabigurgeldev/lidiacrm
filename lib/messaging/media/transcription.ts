/**
 * Transcrição de áudio plugável (Onda 3). Default: API speech-to-text
 * OpenAI-compatível (Whisper) via BYOK — da OpenAI ou, sem chave dela, da
 * OpenRouter (`escolherTranscricao`). O derivado é texto → alimenta QUALQUER
 * modelo de chat (camada universal). Um backend mlx-whisper local implementa a
 * mesma interface para self-host em Apple Silicon (fora deste MVP).
 */
export interface TranscriptionProvider {
  transcribe(audio: Buffer, mime: string): Promise<string>;
}

export interface TranscriptionCreds {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  /**
   * Idioma do áudio (ISO-639-1, ex.: "pt"). Sem ele o modelo ADIVINHA o idioma
   * pelo próprio áudio, e áudio curto ou ruidoso sai em outra língua. Medido em
   * produção (2026-10-08, Açaí Delícia): um áudio em português virou texto em
   * tailandês, e o agente respondeu a algo que o cliente não disse.
   */
  language?: string;
}

/**
 * Idioma da transcrição a partir do locale da organização (`organizations.locale`,
 * ex.: "pt-BR" → "pt"). Locale ausente ou fora do formato → `undefined`, e o
 * modelo volta a detectar sozinho — nunca um idioma inventado.
 */
export function idiomaDaTranscricao(locale: string | null | undefined): string | undefined {
  const m = /^([a-z]{2})(?:[-_][A-Za-z]{2})?$/.exec((locale ?? "").trim());
  return m ? m[1] : undefined;
}

const DEFAULT_BASE = "https://api.openai.com";
const DEFAULT_MODEL = "whisper-1";

/**
 * Por onde a transcrição sai quando a organização não tem chave da OpenAI.
 *
 * A OpenRouter expõe `/api/v1/audio/transcriptions` no MESMO formato
 * multipart da OpenAI — o `apiTranscriptionProvider` abaixo serve sem mudar
 * uma linha, só com outra base e o modelo com prefixo de fabricante. Medido em
 * 2026-10-01 com áudio OGG/Opus (o formato de voz do WhatsApp): `whisper-1`,
 * `whisper-large-v3-turbo` e `gpt-4o-mini-transcribe` responderam 200 com o
 * texto certo. Fica o `gpt-4o-mini-transcribe`: o mais rápido dos três (~0,8s
 * contra 1,7s e 6,5s) e cerca de 4× mais barato que o `whisper-1`.
 *
 * Antes disto, quem instalou só com a OpenRouter (a primeira opção do
 * `install.sh`) tinha o agente respondendo a todo áudio com "não consegui
 * abrir" — a chave que a pessoa TINHA servia, e o código não a usava.
 */
export const TRANSCRICAO_PELA_OPENROUTER = {
  baseUrl: "https://openrouter.ai/api",
  model: "openai/gpt-4o-mini-transcribe",
} as const;

export type OrigemDaTranscricao = "openai" | "openrouter";

export interface EscolhaDaTranscricao {
  origem: OrigemDaTranscricao;
  creds: TranscriptionCreds;
}

/**
 * A escada de chave da transcrição: OpenAI primeiro, OpenRouter depois.
 *
 * OpenAI vem antes porque é o caminho que já funcionava — quem cadastrou as
 * duas chaves não pode ver o áudio trocar de serviço (e de custo) por causa
 * deste conserto. Sem nenhuma das duas, `null`: quem chama abre o aviso na
 * Central em vez de mandar a chave errada para o serviço errado (o 401 em
 * laço que `media-derive-worker.ts` descreve).
 */
export function escolherTranscricao(chaves: {
  openai: string | null;
  openrouter: string | null;
}): EscolhaDaTranscricao | null {
  if (chaves.openai) return { origem: "openai", creds: { apiKey: chaves.openai } };
  if (chaves.openrouter) {
    return {
      origem: "openrouter",
      creds: { apiKey: chaves.openrouter, ...TRANSCRICAO_PELA_OPENROUTER },
    };
  }
  return null;
}

/**
 * O que o painel de provedores mostra no ponto "Ouvir o áudio do cliente".
 *
 * O ponto é fixo e não passa por `decidirBinding`, mas a tela o passava mesmo
 * assim — e anunciava o modelo de CONVERSA da organização ("claude-sonnet-5,
 * usando o padrão da organização") num ponto que nunca o usa. Quem só tinha a
 * OpenRouter lia ali que o áudio estava configurado, enquanto todo áudio caía
 * em "não consegui abrir". Aqui a tela descreve a mesma escada que o worker
 * sobe, a partir das chaves que existem — sem decifrar nenhuma.
 */
export function transcricaoParaATela(tem: { openai: boolean; openrouter: boolean }): {
  /** Nunca nulo: sem chave nenhuma, é o degrau que a escada tenta primeiro. */
  provider: string;
  modelId: string | null;
  porQue: string;
  aviso: string | null;
} {
  const escolha = escolherTranscricao({
    openai: tem.openai ? "x" : null,
    openrouter: tem.openrouter ? "x" : null,
  });
  if (escolha?.origem === "openai") {
    return {
      provider: "openai",
      modelId: escolha.creds.model ?? DEFAULT_MODEL,
      porQue: "Usando sua chave da OpenAI.",
      aviso: null,
    };
  }
  if (escolha?.origem === "openrouter") {
    return {
      provider: "openrouter",
      modelId: escolha.creds.model ?? null,
      porQue: "Usando sua chave da OpenRouter (não há chave da OpenAI cadastrada).",
      aviso: null,
    };
  }
  return {
    provider: "openai",
    modelId: null,
    porQue: "Sem chave para transcrever.",
    aviso:
      "Nenhuma chave da OpenAI ou da OpenRouter cadastrada: o agente não entende os áudios dos clientes. Cadastre uma delas em Credenciais.",
  };
}

function extFor(mime: string): string {
  const base = mime.split(";")[0]!.trim().toLowerCase();
  if (base.includes("ogg")) return "ogg";
  if (base.includes("mpeg") || base.includes("mp3")) return "mp3";
  if (base.includes("mp4") || base.includes("m4a")) return "m4a";
  if (base.includes("webm")) return "webm";
  if (base.includes("wav")) return "wav";
  return "bin";
}

export function apiTranscriptionProvider(
  creds: TranscriptionCreds,
  fetchImpl: typeof fetch = fetch,
): TranscriptionProvider {
  const base = creds.baseUrl ?? DEFAULT_BASE;
  const model = creds.model ?? DEFAULT_MODEL;
  return {
    async transcribe(audio, mime) {
      const form = new FormData();
      form.append("model", model);
      if (creds.language) form.append("language", creds.language);
      form.append(
        "file",
        new Blob([new Uint8Array(audio)], { type: mime.split(";")[0]!.trim() }),
        `audio.${extFor(mime)}`,
      );
      const res = await fetchImpl(`${base}/v1/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${creds.apiKey}` },
        body: form,
      });
      if (!res.ok) throw new Error(`transcription_${res.status}`);
      const json = (await res.json()) as { text?: string };
      return json.text ?? "";
    },
  };
}
