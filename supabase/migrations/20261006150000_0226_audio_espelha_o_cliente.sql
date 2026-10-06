-- ============================================================================
-- 0226 — RESPONDER EM ÁUDIO SÓ QUANDO O CLIENTE MANDOU ÁUDIO.
--
-- `reply_as_audio` (0222) liga a voz para TODA resposta. Medido em produção
-- (2026-10-06): o cliente escreve "oi bom dia" em texto e recebe uma nota de
-- voz — estranho para quem escreveu, e mais lento (síntese + conversão a cada
-- envio). O dono pediu o espelho: texto recebe texto, áudio recebe áudio.
--
-- Por que uma coluna NOVA, e não um terceiro valor em `reply_as_audio`: mudar
-- o sentido do booleano mudaria o comportamento de toda instalação que já o
-- ligou. `reply_as_audio_mirror` só vale com `reply_as_audio` ligado, e o
-- default `false` mantém o "sempre em áudio" de hoje.
--
-- O trigger de imutabilidade aprende a coluna: mudar o modo numa versão
-- PUBLICADA sem virar versão nova é mudança de comportamento sem rastro.
--
-- Aditiva e idempotente.
-- ============================================================================

alter table public.ai_agent_versions
  add column if not exists reply_as_audio_mirror boolean not null default false;

comment on column public.ai_agent_versions.reply_as_audio_mirror is
  'Com reply_as_audio ligado: true = responde em áudio só quando alguma mensagem do cliente desde a última resposta foi áudio (senão texto); false = sempre áudio.';

-- ---- o trigger de imutabilidade aprende reply_as_audio_mirror ----
create or replace function fn_ai_agent_version_content_immutable() returns trigger
language plpgsql as $fn$
begin
  if old.status <> 'draft' and (
       new.system_prompt          is distinct from old.system_prompt
    or new.provider               is distinct from old.provider
    or new.model                  is distinct from old.model
    or new.credential_id          is distinct from old.credential_id
    or new.tool_ids               is distinct from old.tool_ids
    or new.trigger_config         is distinct from old.trigger_config
    or new.channel_session_id     is distinct from old.channel_session_id
    or new.max_steps              is distinct from old.max_steps
    or new.token_budget           is distinct from old.token_budget
    or new.cost_budget_cents      is distinct from old.cost_budget_cents
    or new.history_message_window is distinct from old.history_message_window
    or new.history_token_window   is distinct from old.history_token_window
    or new.handoff_keywords       is distinct from old.handoff_keywords
    or new.handoff_tool_enabled   is distinct from old.handoff_tool_enabled
    or new.followup               is distinct from old.followup
    or new.multimodal_input       is distinct from old.multimodal_input
    or new.video_frames_enabled   is distinct from old.video_frames_enabled
    or new.split_messages         is distinct from old.split_messages
    or new.split_max_chars        is distinct from old.split_max_chars
    or new.reply_as_audio         is distinct from old.reply_as_audio
    or new.audio_voice            is distinct from old.audio_voice
    or new.reply_as_audio_mirror  is distinct from old.reply_as_audio_mirror
    or new.cases_enabled          is distinct from old.cases_enabled
    or new.operator_enabled       is distinct from old.operator_enabled
    or new.operator_model         is distinct from old.operator_model
    or new.operator_tool_ids      is distinct from old.operator_tool_ids
    or new.pipeline_ids           is distinct from old.pipeline_ids
    or new.knowledge_source_ids   is distinct from old.knowledge_source_ids
    or new.api_endpoint_ids       is distinct from old.api_endpoint_ids
    or new.version_number         is distinct from old.version_number
    or new.agent_id               is distinct from old.agent_id
    or new.organization_id        is distinct from old.organization_id
  ) then
    raise exception 'ai_agent_versions % é imutável (status=%): mudança de conteúdo = versão draft nova; rollback = revert (clona + publica)',
      old.id, old.status;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_ai_agent_versions_content_immutable on public.ai_agent_versions;
create trigger trg_ai_agent_versions_content_immutable
  before update on public.ai_agent_versions
  for each row execute function fn_ai_agent_version_content_immutable();
