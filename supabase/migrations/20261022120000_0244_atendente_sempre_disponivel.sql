-- ============================================================================
-- 0244 — ATENDENTE SEMPRE DISPONÍVEL NO HORÁRIO.
--
-- Medido em produção (SEI Parauapebas, 2026-10-22): a dona da conta pediu que
-- as atendentes ficassem "ligadas" para o fluxo de distribuição entregar leads
-- a elas. O CRM só conhecia um jeito de ficar disponível: estar com a caixa de
-- entrada aberta. O cron `attendant-heartbeat` desliga (is_available=false)
-- quem não manda sinal de vida há 15 minutos — defesa certa para quem trabalha
-- com o CRM aberto, e errada para a equipe que atende pelo celular e só abre o
-- CRM de vez em quando: o rodízio e o `routing.fixed_order` nunca a achavam
-- elegível, e todo lead caía em "ninguém disponível".
--
-- `always_available` diz "esta pessoa fica disponível durante o horário dela
-- mesmo com o CRM fechado". O cron passa a pular quem a tem ligada. O horário
-- (`schedule`) e a capacidade continuam valendo: sempre disponível NÃO é 24/7.
-- A pessoa ainda pode se pôr offline pelo próprio botão — `is_available` segue
-- sendo a chave, e quem lê disponibilidade não muda.
--
-- Default `false` mantém o comportamento de toda instalação existente.
-- Aditiva e idempotente.
-- ============================================================================

alter table public.attendant_availability
  add column if not exists always_available boolean not null default false;

comment on column public.attendant_availability.always_available is
  'true = o cron attendant-heartbeat não desliga esta pessoa por falta de sinal de vida; ela fica disponível durante o horário (schedule) mesmo com o CRM fechado. Ligado por manager+.';
