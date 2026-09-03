-- 0211 — o gatilho por WEBHOOK do fluxo.
--
-- A 0207 já abriu `webhook_sources.kind` para `'flow_trigger'` e disse por quê:
-- "sem isso o gatilho por webhook ficaria desenhável na tela e nunca
-- dispararia". O que ela não fez foi o resto: a tabela continua exigindo
-- `default_pipeline_id` e `default_stage_id`, que são de CAPTAÇÃO DE LEAD —
-- um gatilho de fluxo não cria lead, ele acorda um fluxo.
--
-- Esta migration fecha isso sem tabela nova, porque a tabela certa já existe:
-- ela é quem resolve `path_token -> organização`, guarda o segredo cifrado, e
-- já tem RLS e rota pública. Duplicá-la para fluxos daria dois lugares para
-- responder "de quem é este token", e é assim que um vaza.
--
--   - `flow_id` novo, nullable, para a linha de gatilho apontar o fluxo;
--   - as duas colunas de funil passam a aceitar NULL;
--   - um CHECK amarra os dois mundos: captação continua EXIGINDO funil, e
--     gatilho de fluxo exige fluxo. Sem ele, relaxar as colunas deixaria nascer
--     linha de captação sem etapa — que falha só na hora em que alguém preenche
--     o formulário, longe de quem criou.
--
-- Aditiva e idempotente.

alter table public.webhook_sources
  add column if not exists flow_id uuid references public.flows(id) on delete cascade;

comment on column public.webhook_sources.flow_id is
  'O fluxo que este token acorda, quando kind = flow_trigger. NULL nas linhas de captacao de lead. Espelhado em app/api/v1/webhooks/flow/[token]/route.ts.';

alter table public.webhook_sources alter column default_pipeline_id drop not null;
alter table public.webhook_sources alter column default_stage_id   drop not null;

do $coerencia$ begin
  if exists (
    select 1 from pg_constraint
     where conname = 'webhook_sources_kind_coerente'
       and conrelid = 'public.webhook_sources'::regclass
  ) then
    alter table public.webhook_sources drop constraint webhook_sources_kind_coerente;
  end if;

  -- `not valid` NÃO entra aqui de propósito: a tabela é pequena (uma linha por
  -- formulário publicado) e validar agora é barato. Constraint que nasce
  -- inválida é a que ninguém lembra de validar depois.
  alter table public.webhook_sources add constraint webhook_sources_kind_coerente check (
    (kind = 'lead_capture' and default_pipeline_id is not null and default_stage_id is not null)
    or (kind = 'flow_trigger' and flow_id is not null)
  );
end $coerencia$;

create index if not exists webhook_sources_flow_idx
  on public.webhook_sources (flow_id)
  where flow_id is not null;
