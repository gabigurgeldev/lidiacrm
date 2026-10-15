-- ============================================================================
-- 0241 — habilidades (skills) passam a ser escolhidas POR AGENTE.
--
-- Até aqui `loadSkills` carregava toda skill de plataforma para todo agente de
-- toda organização. Com duas skills genéricas (objeção de preço, agendamento)
-- isso servia; com skills de nicho deixa de servir: a skill de urgência clínica
-- entraria no agente da loja, e a de rastreio de pedido no da clínica.
--
-- ── skill_versions.nichos ─────────────────────────────────────────────────
-- Para que ramo a skill foi escrita (`clinica`, `imobiliaria`, `servicos`,
-- `curso`, `loja`). Vazio = UNIVERSAL: vale para todo agente, sempre. Sem
-- CHECK de propósito — o vocabulário é o de `NICHOS`
-- (`lib/ai/agents/construtor/nicho.ts`), conferido no TypeScript, e uma
-- constraint faria o `update.sh` de um clone com valor antigo quebrar.
-- Adicionar coluna com default não dispara o trigger de imutabilidade de
-- `skill_versions` (é DDL, não UPDATE): as versões existentes viram universais.
--
-- ── ai_agent_versions.skill_names ─────────────────────────────────────────
-- As skills OPCIONAIS ligadas nesta versão do agente (de nicho, ou da própria
-- organização). As universais NÃO entram na lista: ficam sempre ligadas, e é
-- assim que uma universal publicada por migration futura chega a versões já
-- publicadas — que são imutáveis.
--   NULL      = padrão: universais + skills próprias da organização. É o que
--               todo agente que já existia passa a ter (decisão do dono do
--               produto: legado recebe só as universais novas).
--   array     = universais + exatamente os nomes da lista.
-- Nullable, sem default, sem backfill.
--
-- O trigger de imutabilidade aprende a coluna: trocar as skills de uma versão
-- PUBLICADA sem virar versão nova seria mudança de comportamento sem rastro.
--
-- Aditiva e idempotente.
-- ============================================================================

alter table public.skill_versions
  add column if not exists nichos text[] not null default '{}';

comment on column public.skill_versions.nichos is
  'Ramos para os quais a skill foi escrita (vocabulário de NICHOS em lib/ai/agents/construtor/nicho.ts). Vazio = universal: vale para todo agente.';

alter table public.ai_agent_versions
  add column if not exists skill_names text[];

comment on column public.ai_agent_versions.skill_names is
  'Skills opcionais (de nicho ou da organização) ligadas nesta versão. Universais valem sempre e não entram aqui. NULL = padrão (universais + skills da organização).';

-- ---- o trigger de imutabilidade aprende skill_names ----
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
    or new.human_request_try_first is distinct from old.human_request_try_first
    or new.interactive_options_enabled is distinct from old.interactive_options_enabled
    or new.cases_enabled          is distinct from old.cases_enabled
    or new.operator_enabled       is distinct from old.operator_enabled
    or new.operator_model         is distinct from old.operator_model
    or new.operator_tool_ids      is distinct from old.operator_tool_ids
    or new.pipeline_ids           is distinct from old.pipeline_ids
    or new.knowledge_source_ids   is distinct from old.knowledge_source_ids
    or new.api_endpoint_ids       is distinct from old.api_endpoint_ids
    or new.skill_names            is distinct from old.skill_names
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

notify pgrst, 'reload schema';
