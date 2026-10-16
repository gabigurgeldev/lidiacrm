-- ============================================================================
-- 0246 — ATENDENTE PODE FICAR DISPONÍVEL PELO HORÁRIO, SEM ABA ABERTA.
--
-- Medido em produção (EDUCATEC, 2026-10-16): seis atendentes com jornada
-- publicada e nenhum online, e o dono perguntou se "ativa sozinho quando entra
-- no horário". Não ativava. Pior: quem ligava a chave "Disponível" caía para
-- offline em até 20 min — o cron `attendant-heartbeat` derruba quem não pinga
-- há 15 min, e nenhuma tela pingava (o `useHeartbeat` citado na rota PATCH
-- nunca existiu). Com o rodízio ligado, ninguém nunca era elegível.
--
-- `follows_schedule` = "a jornada manda". Ligada, a varredura de heartbeat não
-- derruba a pessoa: a chave fica ligada e o HORÁRIO decide, porque a
-- elegibilidade (`isAttendantEligible`) já exige estar dentro da janela. A
-- chave "Disponível" segue sendo a pausa (férias, folga).
--
-- Default `false` mantém o comportamento de toda instalação: online só
-- enquanto o app está aberto (agora com o heartbeat de verdade).
--
-- Aditiva e idempotente.
-- ============================================================================

alter table public.attendant_availability
  add column if not exists follows_schedule boolean not null default false;

comment on column public.attendant_availability.follows_schedule is
  'true = disponível pela jornada (schedule), sem depender de aba aberta: a varredura de heartbeat não derruba. false = online só enquanto o app pinga (heartbeat de 15 min).';
