/**
 * As dependências de um turno do agente, montadas a partir das variáveis do
 * worker — num lugar só.
 *
 * Moravam inline em `workers/agent-worker/main.ts`. Saíram de lá porque o ENSAIO
 * do agente (`lib/agent-engine/ensaio`, botão Testar da tela) roda o MESMO turno
 * dentro do processo do Next, e uma segunda montagem à mão é como o teste passaria
 * a usar janela de histórico, limites e modelos diferentes da produção — o
 * defeito exato do botão Testar antigo, que ensaiava outro motor.
 */
import { completeTurnForEnrollment, createPgAdminClient } from '@/lib/followup/turn-bridge';

import { crmEdgeConfigFromEnv } from '../edge/crm/mcp-client';
import { vozDaOrganizacaoPeloBanco } from '../edge/crm/voz-da-organizacao';
import { llmEdgeConfigFromEnv } from '../edge/llm/run-model-call';
import type { Env } from '../env';
import type { Logger } from '../obs/logger';
import type { FollowupTurnDeps } from './followup-turn';

export function montarDepsDoTurno(env: Env, log: Logger): FollowupTurnDeps {
  return {
    crmCfg: {
      ...crmEdgeConfigFromEnv({
        SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
        TTS_BASE_URL: env.TTS_BASE_URL,
        TTS_TIMEOUT_MS: env.TTS_TIMEOUT_MS,
        TTS_MAX_CHARS: env.TTS_MAX_CHARS,
      }),
      // Sem TTS_BASE_URL, cada organização fala pela própria chave da OpenRouter.
      vozDaOrganizacao: vozDaOrganizacaoPeloBanco({
        databaseUrl: env.SUPABASE_DB_URL,
        llmCfg: llmEdgeConfigFromEnv(env),
        tts: { TTS_TIMEOUT_MS: env.TTS_TIMEOUT_MS, TTS_MAX_CHARS: env.TTS_MAX_CHARS },
      }),
    },
    llmCfg: llmEdgeConfigFromEnv(env),
    knobs: {
      historyLimit: env.LEAD_CONTEXT_HISTORY_LIMIT,
      maxContextTokens: env.LEAD_CONTEXT_MAX_TOKENS,
      notesIndexMaxTokens: env.LEAD_NOTES_INDEX_MAX_TOKENS,
      maxSteps: env.AGENT_MAX_STEPS,
      maxSendsPerTurn: env.MAX_SENDS_PER_TURN,
      queuedRetryDelayMs: env.SEND_QUEUED_RETRY_MS,
      breaker: {
        exactFailureWarn: env.TOOL_BREAKER_EXACT_WARN,
        exactFailureBlock: env.TOOL_BREAKER_EXACT_BLOCK,
        sameToolFailureWarn: env.TOOL_BREAKER_SAME_TOOL_WARN,
        sameToolFailureHalt: env.TOOL_BREAKER_SAME_TOOL_HALT,
        noProgressWarn: env.TOOL_BREAKER_NO_PROGRESS_WARN,
        noProgressBlock: env.TOOL_BREAKER_NO_PROGRESS_BLOCK,
      },
      followup: {
        minAheadMs: env.FOLLOWUP_MIN_AHEAD_MS,
        maxAheadMs: env.FOLLOWUP_MAX_AHEAD_MS,
        staggerWindowMs: env.CRON_STAGGER_WINDOW_MS,
      },
      compaction: {
        triggerMessages: env.COMPACTION_TRIGGER_MESSAGES,
        ...(env.COMPACTION_MODEL !== undefined ? { model: env.COMPACTION_MODEL } : {}),
        transcriptMaxTokens: env.COMPACTION_TRANSCRIPT_MAX_TOKENS,
      },
      prune: {
        windowTurns: env.PRUNE_TOOL_RESULTS_WINDOW_TURNS,
        minResultTokens: env.PRUNE_TOOL_RESULTS_MIN_RESULT_TOKENS,
      },
      goldenCandidatesDir: env.GOLDEN_CANDIDATES_DIR,
      stageClassifier: {
        ...(env.STAGE_CLASSIFIER_MODEL !== undefined ? { model: env.STAGE_CLASSIFIER_MODEL } : {}),
      },
      jailbreak: {
        ...(env.JAILBREAK_CLASSIFIER_MODEL !== undefined ? { model: env.JAILBREAK_CLASSIFIER_MODEL } : {}),
      },
      disclosureMode: env.DISCLOSURE_MODE,
      promiseSemantic: {
        enabled: env.PROMISE_SEMANTIC_ENABLED,
        ...(env.PROMISE_SEMANTIC_MODEL !== undefined ? { model: env.PROMISE_SEMANTIC_MODEL } : {}),
      },
      followupAi: {
        ...(env.FOLLOWUP_AI_MODEL !== undefined ? { model: env.FOLLOWUP_AI_MODEL } : {}),
      },
    },
    log,
    // Onda 5 (Task 5.1): fecha o turno dirigido por fluxo de volta no enrollment —
    // o worker fala pg puro (nunca Supabase client), então usa o adapter pg de
    // lib/followup/turn-bridge.ts (equivalente ao createSupabaseAdminClient das
    // rotas Next.js, mas pra este processo).
    completeFollowupTurn: (pool, { organizationId, enrollmentId, nodeId, result }) =>
      completeTurnForEnrollment(createPgAdminClient(pool), organizationId, enrollmentId, nodeId, result),
  };
}
