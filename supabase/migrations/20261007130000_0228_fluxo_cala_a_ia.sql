-- ============================================================================
-- 0228 — FLUXO DE TRIAGEM: UMA EXECUÇÃO VIVA POR CLIENTE, E A IA CALADA NELA.
--
-- Medido na Gestalt Support (2026-10-07): o dono quer uma pré-triagem por
-- fluxo (nome, sistema, problema) ANTES do agente. Com o motor de hoje, dois
-- defeitos impedem:
--   1. o gatilho "Quando o cliente manda mensagem" arma em TODA mensagem — a
--      resposta do cliente ao menu arma o mesmo fluxo de novo;
--   2. o agente responde a mesma mensagem em paralelo, porque nada no gate da
--      IA olha para fluxo em andamento.
--
-- Duas colunas, gravadas pelo matcher a partir do config do gatilho:
--   - `exclusiva_por_contato`: o índice único parcial abaixo recusa uma segunda
--     execução VIVA do mesmo fluxo para o mesmo contato. É atômico — duas
--     mensagens chegando juntas não armam duas triagens. O matcher já trata o
--     23505 como "pulado".
--   - `silencia_ia`: o turno do agente (e o worker legado) calculam, na hora,
--     se há execução assim cobrindo a mensagem. Calculado, não gravado em
--     `bot_silenced_until`: não há trava a desfazer quando o fluxo termina,
--     morre ou é cancelado — some sozinho.
--
-- Aditiva e idempotente: colunas com default `false` (nenhum fluxo existente
-- muda de comportamento) e o índice único nasce sobre zero linhas elegíveis.
-- ============================================================================

alter table public.flow_executions
  add column if not exists silencia_ia boolean not null default false;
alter table public.flow_executions
  add column if not exists exclusiva_por_contato boolean not null default false;

comment on column public.flow_executions.silencia_ia is
  'O agente de IA não responde ao contato enquanto esta execução está viva, nem a mensagem que chegou durante ela. Vem do gatilho (silenciar_ia).';
comment on column public.flow_executions.exclusiva_por_contato is
  'No máximo uma execução viva deste fluxo por contato (uniq_flow_executions_viva_por_contato). Vem do gatilho (uma_por_contato).';

create unique index if not exists uniq_flow_executions_viva_por_contato
  on public.flow_executions (flow_id, contact_id)
  where exclusiva_por_contato
    and contact_id is not null
    and status in ('pending','running','waiting');

create index if not exists idx_flow_executions_silencia_ia
  on public.flow_executions (organization_id, contact_id, started_at desc)
  where silencia_ia;
