-- ============================================================================
-- 0231 — O TURNO QUE TERMINA SEM RESPONDER AO CLIENTE AVISA.
--
-- O cliente escrevia, o agente rodava, e nada saía: o modelo escrevia a resposta
-- como texto solto (o runtime descarta tudo o que não passa por send_message,
-- de propósito) ou encerrava calado. O turno terminava "ok" com zero envios e a
-- conversa ficava sem resposta sem ninguém saber.
--
-- O runtime agora cobra o modelo UMA vez, com chamada de ferramenta obrigatória
-- (lib/agent-engine/agent/turno-mudo.ts). Se ainda assim nada sai — ou se as
-- tentativas foram todas barradas pelas conferências de envio —, este kind leva
-- o fato à Central de avisos, um por conversa.
--
-- Bloco ÚNICO da constraint (issue #159): reconstrói a lista inteira, igual ao
-- apêndice do baseline. Alargamento puro, idempotente.
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
    'coordenador_preso',
    'turno_sem_resposta',
    'other'
  ));

notify pgrst, 'reload schema';
