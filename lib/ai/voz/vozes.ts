/**
 * Vozes que o agente pode usar quando responde em áudio (migration 0222).
 *
 * Fonte ÚNICA do vocabulário de `ai_agent_versions.audio_voice` — a coluna não
 * tem CHECK de propósito (o catálogo do modelo de voz cresce a cada release, e
 * uma constraint faria o `update.sh` de um clone quebrar). Quem valida é o Zod
 * de `lib/ai/agents/validation.ts`, que deriva daqui.
 *
 * Os ids são os do Kokoro-82M para português do Brasil (prefixo `p`, `f` =
 * feminina, `m` = masculina). Acrescentar uma voz = uma linha aqui.
 */
export const VOZES_DO_AGENTE = ["pf_dora", "pm_alex", "pm_santa"] as const;

export type VozDoAgente = (typeof VOZES_DO_AGENTE)[number];

export const VOZ_PADRAO: VozDoAgente = "pf_dora";

export const ROTULO_DA_VOZ: Record<VozDoAgente, string> = {
  pf_dora: "Dora (feminina)",
  pm_alex: "Alex (masculina)",
  pm_santa: "Santa (masculina)",
};
