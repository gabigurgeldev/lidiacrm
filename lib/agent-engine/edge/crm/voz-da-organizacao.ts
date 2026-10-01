/**
 * A voz da ORGANIZAÇÃO: o Grok pela chave da OpenRouter dela.
 *
 * Vale quando a instalação não configurou serviço próprio (`TTS_BASE_URL`) —
 * a regra é `servicoDeVoz` (`lib/ai/voz/vozes.ts`). A chave sai do mesmo
 * resolvedor que o turno do agente usa (credencial ativa e validada da org,
 * ou `OPENROUTER_API_KEY` da instalação como último degrau), então quem já
 * conversa pela OpenRouter fala sem cadastrar nada.
 *
 * Pool próprio e preguiçoso, como o de `workers/media-derive-worker.ts`: a
 * borda de envio só recebe um `Queryable`, e o resolvedor exige `pg.Pool`. O
 * pool só nasce na primeira fala — instalação sem voz não abre conexão.
 */
import type pg from 'pg';

import { createPool } from '@/lib/agent-engine/db/pool';
import { resolveOrgLlmConfig, type LlmEdgeConfig } from '@/lib/agent-engine/edge/llm/credentials';
import { vozPelaOpenRouter, type VozDoEnvio } from '@/lib/messaging/media/tts';

export function vozDaOrganizacaoPeloBanco(opts: {
  databaseUrl: string;
  llmCfg: LlmEdgeConfig;
  tts: { TTS_TIMEOUT_MS?: number; TTS_MAX_CHARS?: number };
  /** Injetável para teste. */
  resolver?: typeof resolveOrgLlmConfig;
}): (organizationId: string) => Promise<VozDoEnvio | null> {
  let pool: pg.Pool | null = null;
  const resolver = opts.resolver ?? resolveOrgLlmConfig;
  return async (organizationId) => {
    try {
      pool ??= createPool(opts.databaseUrl);
      const cfg = await resolver(pool, opts.llmCfg, organizationId, { provider: 'openrouter' });
      return vozPelaOpenRouter(cfg.apiKey, opts.tts);
    } catch {
      // Sem chave da OpenRouter (ou banco fora): sem voz. Quem chama manda a
      // resposta em TEXTO e abre o aviso — nunca deixa o lead sem resposta.
      return null;
    }
  };
}
