-- 0209 — de qual FLUXO veio esta campanha.
--
-- `bulk_sends.created_by_user_id` responde "quem criou" enquanto criar é ato de
-- gente. Com o bloco `whatsapp.bulk_send`, quem cria pode ser um fluxo — e a
-- coluna, sendo nullable, aceita `null` sem reclamar. O resultado seria uma
-- campanha órfã na tela de Disparos: ninguém a criou, e não há como saber de
-- onde veio nem qual fluxo desligar quando ela estiver errada.
--
-- A coluna nova é o rastro. `on delete set null` porque o expurgo de execuções
-- antigas não pode levar a campanha junto: o histórico do disparo vale mais que
-- a linhagem dele.
--
-- Aditiva e idempotente.

alter table public.bulk_sends
  add column if not exists created_by_flow_execution_id uuid
    references public.flow_executions(id) on delete set null;

comment on column public.bulk_sends.created_by_flow_execution_id is
  'A execucao de fluxo que criou esta campanha, quando ela nao foi criada por uma pessoa. NULL nas criadas pela tela. Espelhado em lib/bulk-send/criar-disparo.ts (AutorDoDisparo).';

create index if not exists bulk_sends_created_by_flow_execution_idx
  on public.bulk_sends (created_by_flow_execution_id)
  where created_by_flow_execution_id is not null;
