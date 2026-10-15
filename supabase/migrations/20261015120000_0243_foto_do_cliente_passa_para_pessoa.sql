-- ============================================================================
-- 0243 — FOTO DO CLIENTE PODE PASSAR DIRETO PARA UMA PESSOA.
--
-- Medido numa floricultura real (Faby Flores e Jardim, 2026-10-15): o cliente
-- manda a foto de uma planta e pergunta "vcs tem dessa??". O agente vê a foto,
-- descreve, e — sem o item no acervo — oscila: ora diz que vai confirmar, ora
-- solta um valor. A regra "não invente preço" mora só no prompt; nada no
-- código liga "o que a foto mostra" a "isto existe no catálogo". A dona pediu:
-- foto do cliente vai para a equipe, e a IA só volta quando alguém devolver.
--
-- `handoff_on_customer_image` liga essa passagem DETERMINÍSTICA, antes do
-- modelo (`clienteMandouFoto`, lib/agent-engine/agent/foto-do-cliente.ts): não
-- depende de o modelo obedecer. Default `false` mantém o comportamento de toda
-- instalação existente — loja cujo acervo cobre o catálogo quer o agente
-- respondendo à foto.
--
-- O trigger de imutabilidade aprende a coluna: mudar o modo numa versão
-- PUBLICADA sem virar versão nova é mudança de comportamento sem rastro.
--
-- Aditiva e idempotente.
-- ============================================================================

alter table public.ai_agent_versions
  add column if not exists handoff_on_customer_image boolean not null default false;

comment on column public.ai_agent_versions.handoff_on_customer_image is
  'Cliente mandou FOTO: true = passa para uma pessoa da equipe antes do modelo, e a IA fica parada até alguém devolver; false = o agente responde à foto. Não depende da ferramenta de passagem.';

-- ---- o trigger de imutabilidade aprende handoff_on_customer_image ----
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
    or new.handoff_on_customer_image is distinct from old.handoff_on_customer_image
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
