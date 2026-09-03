-- ============================================================================
-- 0209 — O ARQUIVO DO WEBHOOK TAMBÉM ESQUECEU A STEVO.
--
-- A 0206 recriou os DOIS checks de `channel_sessions` (`_provider_check` e
-- `_provider_ref_check`) para aceitar `stevo` — mas `webhook_events_log` tem
-- o SEU PRÓPRIO check de provider, numa tabela diferente, e ninguém tocou
-- nele. Medido em produção: toda entrega de webhook de uma conta Stevo
-- falhava ao arquivar o corpo cru com
--
--   new row for relation "webhook_events_log" violates check constraint
--   "webhook_events_log_provider_check"
--
-- A mensagem em si continuava sendo processada (`abrirArquivoDoWebhook`
-- devolve `null` e loga um aviso, sem derrubar a ingestão — ver o cabeçalho
-- de `lib/channels/arquivo-de-webhook.ts`), mas o corpo cru nunca ficava
-- arquivado: exatamente a peça que faltava pra medir o formato real do
-- payload Oficial nesta mesma investigação.
--
-- Alargamento puro, mesma garantia da 0151: um CHECK que aceita MAIS valores
-- não pode ser violado por linha que já passava pelo antigo — sem backfill.
-- ============================================================================

alter table public.webhook_events_log
  drop constraint if exists webhook_events_log_provider_check;

alter table public.webhook_events_log
  add constraint webhook_events_log_provider_check check (provider in (
    'waha', 'nuvemshop', 'generic', 'meta_cloud', 'zernio', 'stevo'
  ));
