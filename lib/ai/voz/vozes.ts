/**
 * Vozes que o agente pode usar quando responde em áudio (migration 0222).
 *
 * Fonte ÚNICA do vocabulário de `ai_agent_versions.audio_voice` — a coluna não
 * tem CHECK de propósito (o catálogo do modelo de voz cresce a cada release, e
 * uma constraint faria o `update.sh` de um clone quebrar). Quem valida é o Zod
 * de `lib/ai/agents/validation.ts`, que deriva daqui.
 *
 * Dois serviços, cada um com as suas vozes — um id de um não existe no outro:
 *
 *  - `kokoro`: o Kokoro-82M que o operador instala na VPS (`TTS_BASE_URL`).
 *    Ids para português do Brasil (prefixo `p`, `f` = feminina, `m` = masculina).
 *  - `grok`: o `x-ai/grok-voice-tts-1.0`, pela chave da OpenRouter da própria
 *    organização. As cinco vozes oficiais da xAI; o idioma é detectado do texto.
 *
 * Acrescentar uma voz = uma linha aqui.
 */
export const SERVICOS_DE_VOZ = ["kokoro", "grok"] as const;
export type ServicoDeVoz = (typeof SERVICOS_DE_VOZ)[number];

export const VOZES_POR_SERVICO = {
  kokoro: ["pf_dora", "pm_alex", "pm_santa"],
  grok: ["eve", "ara", "rex", "sal", "leo"],
} as const satisfies Record<ServicoDeVoz, readonly string[]>;

export const VOZES_DO_AGENTE = [...VOZES_POR_SERVICO.kokoro, ...VOZES_POR_SERVICO.grok] as const;

export type VozDoAgente = (typeof VOZES_DO_AGENTE)[number];

/** O default da coluna (`'pf_dora'`, migration 0222) — não muda sem migration. */
export const VOZ_PADRAO: VozDoAgente = "pf_dora";

export const VOZ_PADRAO_DO_SERVICO: Record<ServicoDeVoz, VozDoAgente> = {
  kokoro: "pf_dora",
  grok: "eve",
};

export const ROTULO_DA_VOZ: Record<VozDoAgente, string> = {
  pf_dora: "Dora (feminina)",
  pm_alex: "Alex (masculina)",
  pm_santa: "Santa (masculina)",
  eve: "Eve (animada)",
  ara: "Ara (calorosa)",
  rex: "Rex (profissional)",
  sal: "Sal (equilibrada)",
  leo: "Leo (firme)",
};

/**
 * A voz que de fato vai ao serviço.
 *
 * Uma versão gravada com voz do Kokoro (inclusive o default da coluna,
 * `pf_dora`) numa instalação que fala pelo Grok mandaria um id que o Grok não
 * conhece — e a síntese falharia em toda mensagem. A voz pertence ao serviço:
 * fora do catálogo dele, vale a voz padrão daquele serviço.
 */
export function vozParaOServico(voz: string, servico: ServicoDeVoz): VozDoAgente {
  const doServico: readonly string[] = VOZES_POR_SERVICO[servico];
  return doServico.includes(voz) ? (voz as VozDoAgente) : VOZ_PADRAO_DO_SERVICO[servico];
}

/**
 * Por qual serviço esta organização fala — `null` = não fala.
 *
 * A instalação que configurou um serviço próprio (`TTS_BASE_URL`) fez uma
 * escolha explícita, e ela vence. Sem ele, a chave da OpenRouter da
 * organização basta: a voz sai pelo Grok, sem nada rodando na VPS, e cada
 * organização paga a sua. Tela e worker chamam esta mesma regra — se cada um
 * decidisse do seu jeito, a tela poderia oferecer vozes de um serviço enquanto
 * o envio usa o outro.
 */
export function servicoDeVoz(tem: { ttsBaseUrl: string | undefined; chaveOpenRouter: boolean }): ServicoDeVoz | null {
  if (tem.ttsBaseUrl?.trim()) return "kokoro";
  if (tem.chaveOpenRouter) return "grok";
  return null;
}
