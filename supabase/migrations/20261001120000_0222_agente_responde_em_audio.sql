-- ============================================================================
-- 0222 — O AGENTE PODE RESPONDER EM ÁUDIO.
--
-- Toggle por versão do agente: ligado, cada mensagem que o agente envia sai
-- como nota de voz, sintetizada por um serviço de voz (TTS) que o operador
-- instala ao lado do CRM — hoje o Kokoro-FastAPI, API compatível com
-- `POST /v1/audio/speech`. Sem o serviço (`TTS_BASE_URL` vazio) nada muda: a
-- tela desabilita o toggle e o runtime segue mandando texto.
--
-- Três peças, e as três são obrigatórias juntas:
--
--   1. `reply_as_audio` / `audio_voice` em `ai_agent_versions` — comportamento
--      é da VERSÃO, como `split_messages` (0059). `audio_voice` é vocabulário
--      ABERTO (o catálogo de vozes cresce a cada release do modelo), então sem
--      CHECK: o vocabulário vive em `lib/ai/voz/vozes.ts` e o Zod valida.
--   2. O trigger de imutabilidade aprende as duas colunas. Voz editável numa
--      versão PUBLICADA sem virar versão nova é mudança de comportamento sem
--      rastro — mesma frase da 0125 e da 0181.
--   3. `agent_inbox_items.kind` ganha `voz_indisponivel`: quando a síntese
--      falha, o lead recebe a resposta em TEXTO (nunca fica sem resposta) e o
--      operador recebe o aviso na Central. Sem o aviso, "o agente parou de
--      mandar áudio" seria um defeito que só o cliente final enxerga.
--
-- Aditiva e idempotente: colunas com default, constraint só alarga.
-- ============================================================================

alter table public.ai_agent_versions
  add column if not exists reply_as_audio boolean not null default false;

alter table public.ai_agent_versions
  add column if not exists audio_voice text not null default 'pf_dora';

comment on column public.ai_agent_versions.reply_as_audio is
  'Ligado = cada mensagem do agente sai como nota de voz (TTS do operador, TTS_BASE_URL). Mensagem com link ou longa demais segue em texto; falha na síntese manda texto e abre aviso voz_indisponivel.';
comment on column public.ai_agent_versions.audio_voice is
  'Voz da síntese (ex.: pf_dora, pm_alex, pm_santa). Vocabulário aberto, validado em lib/ai/voz/vozes.ts.';

-- ---- o trigger de imutabilidade aprende as colunas novas ----
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
    or new.cases_enabled          is distinct from old.cases_enabled
    or new.operator_enabled       is distinct from old.operator_enabled
    or new.operator_model         is distinct from old.operator_model
    or new.operator_tool_ids      is distinct from old.operator_tool_ids
    or new.pipeline_ids           is distinct from old.pipeline_ids
    or new.knowledge_source_ids   is distinct from old.knowledge_source_ids
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

-- ──────────────── agent_inbox_items.kind ganha 'voz_indisponivel' ────────────
--
-- Bloco ÚNICO com o vocabulário INTEIRO vigente (issue #159).
-- `tests/unit/kind-check-migration-x-baseline.test.ts` compara esta lista com
-- a do baseline, valor a valor.
alter table public.agent_inbox_items
  drop constraint if exists agent_inbox_items_kind_check;

alter table public.agent_inbox_items
  add constraint agent_inbox_items_kind_check check (kind in (
    'qr_rescan',
    'job_dead',
    'event_dead',
    'budget_exceeded',
    'handoff',
    'promotion_review',
    'judge_unaligned',
    'followup_dead',
    'snooze_expired',
    'next_action_ambiguous',
    'risk_backlog_seeded',
    'reactivation_expired',
    'capabilities_missing',
    'message_send_stuck',
    'midia_nao_lida',
    'channel_template_review',
    'channel_number_alert',
    'promise_unfulfilled',
    'contact_proposal_expired',
    'budget_warning',
    'conhecimento_nao_indexado',
    'disparo_travado',
    'voz_indisponivel',
    'other'
  ));

notify pgrst, 'reload schema';
