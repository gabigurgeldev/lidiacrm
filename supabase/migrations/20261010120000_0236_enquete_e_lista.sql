-- ============================================================================
-- 0236 — ENQUETE E LISTA viram tipos de mensagem, e o agente ganha a chave.
--
-- Até aqui toda escolha do cliente era texto numerado (1️⃣ 2️⃣ 3️⃣): o bloco
-- "Esperar uma escolha" mandava a lista no corpo e casava o que a pessoa
-- digitava. O WhatsApp tem duas formas nativas de oferecer opções — a enquete
-- (canal por QR) e a lista interativa (QR e oficial) — e a pessoa toca em vez
-- de digitar.
--
-- ── Por que tipo PRÓPRIO, e não `type: 'text'` com as opções no corpo ──────
-- Pelo mesmo motivo da 0091 com `template`: a linha diria "texto" para uma
-- mensagem que o contato viu como enquete. O corpo continua guardando a
-- pergunta e as opções em texto (preview, busca, LGPD), mas QUEM a mensagem
-- foi está no tipo — e é dele que a tela decide desenhar o cartão de opções,
-- e o recebimento decide procurar a mensagem de origem de um voto.
--
-- A RESPOSTA do cliente NÃO ganha tipo novo: volta como `text` com o rótulo da
-- opção no corpo (e a origem em `metadata.resposta_interativa`). Assim tudo
-- que já lê texto de entrada — fluxo esperando escolha, agente, coordenador,
-- detecção de STOP, roteador — funciona sem saber que houve um toque.
--
-- ── Backfill: nenhum, por construção ──────────────────────────────────────
-- Só ACRESCENTA valores ao conjunto permitido; o conjunto antigo é
-- subconjunto do novo, então toda linha de qualquer clone continua válida.
--
-- ── A chave do agente ─────────────────────────────────────────────────────
-- `interactive_options_enabled` decide se o agente recebe a ferramenta de
-- mandar opções. Default TRUE: é capacidade nova que só aparece quando o canal
-- suporta, e quem não quiser desliga por agente. O trigger de imutabilidade
-- aprende a coluna — mudar isto numa versão PUBLICADA sem virar versão nova
-- seria mudança de comportamento sem rastro.
--
-- Aditiva e idempotente.
-- ============================================================================

do $$ begin
  alter table public.messages drop constraint if exists messages_type_check;
  alter table public.messages add constraint messages_type_check
    check (type = any (array[
      'text', 'image', 'video', 'audio', 'document', 'sticker',
      'location', 'contact', 'reaction', 'system', 'template',
      -- novos: opções interativas mandadas por nós (a resposta volta como text)
      'poll', 'list'
    ]));
end $$;

alter table public.ai_agent_versions
  add column if not exists interactive_options_enabled boolean not null default true;

comment on column public.ai_agent_versions.interactive_options_enabled is
  'O agente pode mandar opções tocáveis (enquete no canal por QR, lista interativa onde houver). Canal que não suporta recebe as mesmas opções em texto numerado.';

-- ---- o trigger de imutabilidade aprende interactive_options_enabled ----
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

-- ---- a Central aprende escolha_nao_lida ----
-- O cliente votou numa enquete e o voto chegou sem a opção decifrada (o
-- transporte avisa com poll.vote.failed). O fluxo ou o agente que esperava a
-- escolha não sabe o que ele tocou — sem este aviso, a conversa fica parada
-- até o prazo do menu vencer e ninguém entende por quê.
--
-- Bloco ÚNICO da constraint (issue #159): reconstrói a lista inteira, igual ao
-- apêndice do baseline (que é editado NO bloco único, não apendado).
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
    'integracao_api_falhando',
    'acao_externa_falhou',
    'verificacao_bloqueada',
    'coordenador_preso',
    'turno_sem_resposta',
    'escolha_nao_lida',
    'other'
  ));

notify pgrst, 'reload schema';
