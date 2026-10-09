/**
 * Uma versão validada (`VersionInput`) → as colunas de `ai_agent_versions` que
 * o INSERT da versão 1 grava.
 *
 * Saiu de `POST /api/v1/ai/agents` quando "Criar agente com IA" passou a criar
 * agentes também. Esta lista já deixou campos para trás uma vez (papel
 * Operador, escopo de funil e acervo eram aceitos no corpo e descartados no
 * INSERT, com 201) — duas cópias dela seriam duas chances de repetir isso.
 *
 * Fica de fora o que é de QUEM cria, não da versão: organização, agente,
 * número da versão, status e autor.
 */
import type { VersionInput } from "./validation";

export function linhaDeVersaoNova(v: VersionInput) {
  return {
    system_prompt: v.system_prompt,
    provider: v.provider,
    model: v.model,
    credential_id: v.credential_id,
    tool_ids: v.tool_ids,
    trigger_config: v.trigger_config ?? undefined,
    channel_session_id: v.channel_session_id,
    max_steps: v.max_steps,
    token_budget: v.token_budget,
    cost_budget_cents: v.cost_budget_cents,
    history_message_window: v.history_message_window,
    history_token_window: v.history_token_window,
    handoff_keywords: v.handoff_keywords,
    handoff_tool_enabled: v.handoff_tool_enabled,
    cases_enabled: v.cases_enabled,
    split_messages: v.split_messages,
    split_max_chars: v.split_max_chars,
    reply_as_audio: v.reply_as_audio,
    reply_as_audio_mirror: v.reply_as_audio_mirror,
    human_request_try_first: v.human_request_try_first,
    audio_voice: v.audio_voice,
    followup: v.followup,
    operator_enabled: v.operator_enabled,
    operator_model: v.operator_model,
    operator_tool_ids: v.operator_tool_ids,
    pipeline_ids: v.pipeline_ids,
    knowledge_source_ids: v.knowledge_source_ids,
    api_endpoint_ids: v.api_endpoint_ids,
  };
}
