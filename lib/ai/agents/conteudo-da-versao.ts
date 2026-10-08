/**
 * O CONTEÚDO de uma versão de agente — as colunas de `ai_agent_versions` que a
 * tela edita —, montado num lugar só.
 *
 * Três caminhos gravam versão: salvar rascunho, criar agente e reverter para uma
 * versão antiga. Cada um listava as colunas à mão, e cada lista esqueceu alguma
 * coisa em algum momento:
 *
 *  - criar agente descartava papel Operador, escopo de funil e acervo (consertado
 *    à mão uma vez) — e continuou descartando `followup`;
 *  - reverter descartava `followup`, que volta ao default do banco
 *    (`enabled: false`): reverter um agente DESLIGAVA os follow-ups dele em
 *    silêncio, sem nada na tela dizer isso.
 *
 * Uma lista por caminho é como a coluna nova entra em um e não nos outros. Aqui
 * a lista é uma só, e `tests/unit/conteudo-da-versao.test.ts` reprova quando um
 * campo do `versionCreateSchema` (o que a tela manda) não tem destino nela.
 */
import type { VersionInput } from "./validation";

/**
 * As colunas que `conteudoDaVersao` grava — para quem COPIA uma versão (revert,
 * proposta aplicada) ler exatamente o que vai gravar. O teste confere que esta
 * lista e as chaves da função são a mesma coisa.
 */
export const COLUNAS_DO_CONTEUDO = [
  "system_prompt",
  "provider",
  "model",
  "credential_id",
  "tool_ids",
  "trigger_config",
  "channel_session_id",
  "max_steps",
  "token_budget",
  "cost_budget_cents",
  "history_message_window",
  "history_token_window",
  "handoff_keywords",
  "handoff_tool_enabled",
  "cases_enabled",
  "split_messages",
  "split_max_chars",
  "reply_as_audio",
  "reply_as_audio_mirror",
  "human_request_try_first",
  "audio_voice",
  "followup",
  "operator_enabled",
  "operator_model",
  "operator_tool_ids",
  "pipeline_ids",
  "knowledge_source_ids",
  "api_endpoint_ids",
] as const;

export function conteudoDaVersao(v: VersionInput) {
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
    // O escopo vai junto em TODO caminho: voltar para uma versão e NÃO voltar a
    // permissão dela seria publicar uma configuração que nunca existiu.
    pipeline_ids: v.pipeline_ids,
    knowledge_source_ids: v.knowledge_source_ids ?? [],
    api_endpoint_ids: v.api_endpoint_ids ?? [],
  };
}
