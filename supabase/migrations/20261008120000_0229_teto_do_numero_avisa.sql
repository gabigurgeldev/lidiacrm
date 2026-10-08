-- ============================================================================
-- 0229 — O NÚMERO QUE CHEGOU AO TETO DO DIA AVISA, E O AGENTE ADIA EM VEZ DE CALAR.
--
-- O aquecimento anti-ban limita quantas mensagens um número manda por dia, por
-- degraus de idade (20 → 50 → 100 → 200 → sem teto). Dois defeitos juntos faziam
-- o agente parar de responder sem nenhum sinal:
--
--   1. A idade do número vinha só de `channel_knobs.number_activated_at`, e essa
--      linha só nasce quando alguém salva a tela de Proteção de envio. Sem ela, a
--      idade era 0 PARA SEMPRE — teto de 20 envios/dia num número de meses.
--      Corrigido em código (`ativacaoEfetiva`, lib/agent-engine/pacing/engine.ts):
--      sem data declarada, a idade conta desde `channel_sessions.created_at`.
--      Nenhuma linha é gravada: a regra é calculada na leitura, então vale para
--      todo clone sem backfill.
--
--   2. Atingido o teto, o veto voltava ao modelo como erro de ensino e o turno
--      terminava "ok" com zero envios. Agora o turno é ADIADO para a próxima
--      abertura — e este kind leva o fato à Central de avisos.
--
-- Bloco ÚNICO da constraint (issue #159): reconstrói a lista inteira, igual ao
-- apêndice do baseline (`kind-check-migration-x-baseline.test.ts`). Alargamento
-- puro: nenhuma linha existente viola a constraint nova. Idempotente.
-- ============================================================================

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
    'teto_do_numero',
    'other'
  ));

notify pgrst, 'reload schema';
