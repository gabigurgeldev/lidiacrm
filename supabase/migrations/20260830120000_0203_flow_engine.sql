-- 0203 · Flow Engine — o motor de automação por grafo, com registry de nós.
--
-- ─── Por que um motor novo, e não mais um nó no follow-up ─────────────────────
-- O repo já tem DOIS motores. `lib/automation` casa evento do `event_log` contra
-- uma regra linear (condições em AND, ações em série). `lib/followup` percorre um
-- GRAFO com relógio próprio (`followup_enrollments.next_eval_at`), e é dele que
-- vêm as peças difíceis: versão publicada imutável, claim justo entre organizações,
-- backoff, dead-man, log de passo idempotente.
--
-- O que nenhum dos dois tem é o que decide esta feature: um REGISTRY DE NÓS. O
-- grafo do follow-up é uma união Zod fechada de 8 tipos (`lib/followup/graph-schema.ts`),
-- e cada tipo novo custa editar cinco arquivos. Um motor de automação de propósito
-- geral precisa que "adicionar um nó" seja declarar uma definição e registrá-la —
-- caso contrário o catálogo de nós é um teto, não um começo.
--
-- Decisão do dono do produto (2026-08-30): motor novo em `lib/flow-engine`, com
-- tabelas próprias. Os dois motores atuais seguem intactos e em produção; nada
-- aqui os toca.
--
-- ─── As quatro tabelas ───────────────────────────────────────────────────────
--   flows                  ponteiro MUTÁVEL — o que o operador edita (rascunho)
--   flow_versions          o grafo IMUTÁVEL publicado; execução em voo é fixada nele
--   flow_executions        uma execução, com UM cursor (`current_node_id`)
--   flow_execution_events  o passo a passo, append-only, com chave de idempotência
--
-- ─── Por que `trigger_config` é fixado na VERSÃO, e não só no ponteiro ────────
-- O follow-up guarda o gatilho só no ponteiro (`followup_flow_pointers.trigger_config`).
-- Isso significa que editar o gatilho muda, retroativamente, sob qual condição as
-- execuções JÁ EM VOO acham que foram armadas — e o dossiê passa a mentir sobre a
-- própria origem. Aqui a versão publicada carrega a cópia: o artefato publicado é
-- inteiro, e a execução aponta para ele.
--
-- ─── Por que NÃO existe tabela de dead-letter ────────────────────────────────
-- `flow_executions.status='dead'` JÁ É a fila de erro; a tela de erros é uma
-- consulta com botão de reprocessar. Uma tabela `flow_dead_letters` seria a mesma
-- verdade em dois lugares, e as duas divergiriam no primeiro reprocessamento.
--
-- ─── Por que NÃO há unique de "uma execução viva por lead" ───────────────────
-- O follow-up tem `idx_followup_enrollments_one_live (pointer_id, contact_id)`,
-- e ali faz sentido: uma cadência por contato. Aqui não — `lead.created` e
-- `lead.stage_changed` são gatilhos DIFERENTES do mesmo fluxo sobre o mesmo lead,
-- e bloquear o segundo perderia automação legítima. O que dedupa é
-- `uniq_flow_executions_trigger_event`: UM evento arma um fluxo no máximo uma vez,
-- mesmo que o drain reentregue a linha (mesmo raciocínio de
-- `uniq_job_queue_source_event`).
--
-- ─── attendant_availability.notification_phone ───────────────────────────────
-- Não existe telefone de usuário em lugar nenhum do schema: varredura de colunas
-- de telefone do baseline devolve `channel_sessions.phone_number` e
-- `contacts.phone_number`, e nada mais. O nome do atendente sequer vive em tabela
-- (a 0202 o desnormalizou em `conversations.assigned_to_user_name` porque resolvê-lo
-- custava uma chamada HTTP ao GoTrue). Sem esta coluna, "avisar o vendedor no
-- WhatsApp" não tem para onde enviar.
--
-- O lugar é `attendant_availability` e não uma tabela nova: é o registro POR
-- ORGANIZAÇÃO do atendente, já com `unique (organization_id, user_id)` e RLS. O
-- telefone de aviso é fato do atendente NAQUELA organização — a mesma pessoa em
-- dois tenants pode querer dois números, e uma coluna em `auth.users` não saberia
-- disso.
--
-- Idempotente e auto-curativa: re-aplicar não duplica nem quebra.

-- ───────────────────────────── flows ─────────────────────────────────────────

create table if not exists public.flows (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  name                text not null,
  folder              text,
  status              text not null default 'draft',
  active_version_id   uuid,
  draft_graph         jsonb,
  trigger_config      jsonb not null default '{"kind":"manual"}'::jsonb,
  settings            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by_user_id  uuid references auth.users(id) on delete set null
);

do $flows_status$ begin
  alter table public.flows drop constraint if exists flows_status_check;
  alter table public.flows add constraint flows_status_check
    check (status in ('draft','active','paused'));
end $flows_status$;

create unique index if not exists uniq_flows_org_name
  on public.flows (organization_id, lower(name));

-- ─────────────────────────── flow_versions ───────────────────────────────────

create table if not exists public.flow_versions (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  flow_id               uuid not null references public.flows(id) on delete cascade,
  version_number        integer not null,
  graph                 jsonb not null,
  -- Cópia fixada do gatilho no instante da publicação — ver cabeçalho.
  trigger_config        jsonb not null,
  published_by_user_id  uuid references auth.users(id) on delete set null,
  published_at          timestamptz not null default now()
);

create unique index if not exists uniq_flow_versions_number
  on public.flow_versions (flow_id, version_number);

do $flows_fk$ begin
  alter table public.flows drop constraint if exists flows_active_version_fk;
  alter table public.flows add constraint flows_active_version_fk
    foreign key (active_version_id) references public.flow_versions(id) on delete set null;
end $flows_fk$;

-- ────────────────────────── flow_executions ──────────────────────────────────

create table if not exists public.flow_executions (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  flow_id           uuid not null references public.flows(id) on delete cascade,
  version_id        uuid not null references public.flow_versions(id),
  status            text not null default 'pending',
  current_node_id   text not null,
  next_eval_at      timestamptz,
  claimed_until     timestamptz,
  attempts          smallint not null default 0,
  max_attempts      smallint not null default 5,
  last_error        text,
  steps_taken       smallint not null default 0,
  outcome           text,
  -- As variáveis da execução (`{{vars.*}}`). Escopo de execução, nunca de fluxo.
  context           jsonb not null default '{}'::jsonb,
  lead_id           uuid references public.crm_leads(id) on delete cascade,
  contact_id        uuid references public.contacts(id) on delete cascade,
  conversation_id   uuid references public.conversations(id) on delete set null,
  -- `event_log.id`, SEM foreign key: o event_log é podado por retenção, e uma FK
  -- faria a poda apagar histórico de execução junto (cascade fantasma).
  trigger_event_id  uuid,
  -- Anti-loop (profundidade 1): de onde veio, para o matcher não rearmar a si mesmo.
  lineage           jsonb not null default '{}'::jsonb,
  started_at        timestamptz not null default now(),
  completed_at      timestamptz,
  updated_at        timestamptz not null default now()
);

do $exec_checks$ begin
  alter table public.flow_executions drop constraint if exists flow_executions_status_check;
  alter table public.flow_executions add constraint flow_executions_status_check
    check (status in ('pending','running','waiting','paused','completed','cancelled','dead'));

  -- Estado com relógio TEM next_eval_at; pausado e terminais NÃO. Coerência no
  -- schema, não na prosa — mesmo cinto do `followup_enrollments`.
  alter table public.flow_executions drop constraint if exists flow_executions_clock_check;
  alter table public.flow_executions add constraint flow_executions_clock_check
    check (
      (status in ('pending','running','waiting') and next_eval_at is not null)
      or (status in ('paused','completed','cancelled','dead'))
    );
end $exec_checks$;

create index if not exists idx_flow_executions_due
  on public.flow_executions (next_eval_at)
  where status in ('pending','running','waiting');

create index if not exists idx_flow_executions_due_por_org
  on public.flow_executions (organization_id, next_eval_at)
  where status in ('pending','running','waiting');

create index if not exists idx_flow_executions_listagem
  on public.flow_executions (organization_id, flow_id, started_at desc);

create index if not exists idx_flow_executions_erros
  on public.flow_executions (organization_id, started_at desc)
  where status = 'dead';

-- UM evento arma um fluxo no máximo uma vez. É este índice que torna o matcher
-- seguro sob reentrega do drain — sem ele, um retry duplicaria a automação.
create unique index if not exists uniq_flow_executions_trigger_event
  on public.flow_executions (flow_id, trigger_event_id)
  where trigger_event_id is not null;

-- ──────────────────────── flow_execution_events ──────────────────────────────

create table if not exists public.flow_execution_events (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  execution_id     uuid not null references public.flow_executions(id) on delete cascade,
  node_id          text,
  event_type       text not null,
  payload          jsonb not null default '{}'::jsonb,
  idempotency_key  text,
  created_at       timestamptz not null default now()
);

create unique index if not exists uniq_flow_execution_events_idem
  on public.flow_execution_events (execution_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists idx_flow_execution_events_trilha
  on public.flow_execution_events (execution_id, created_at);

-- ──────────────── attendant_availability.notification_phone ──────────────────

alter table public.attendant_availability
  add column if not exists notification_phone text;

comment on column public.attendant_availability.notification_phone is
  'E.164 para onde o Flow Engine avisa este atendente (no whatsapp.notify_user). Por organizacao: a mesma pessoa em dois tenants pode ter dois numeros.';

-- Corrige o dado ANTES da constraint: um clone com telefone fora do formato
-- travaria o update.sh. O que não casa o formato vira NULL.
update public.attendant_availability
   set notification_phone = null
 where notification_phone is not null
   and notification_phone !~ '^\+[0-9]{8,15}$';

do $phone_check$ begin
  alter table public.attendant_availability
    drop constraint if exists attendant_availability_notification_phone_e164;
  alter table public.attendant_availability
    add constraint attendant_availability_notification_phone_e164
    check (notification_phone is null or notification_phone ~ '^\+[0-9]{8,15}$');
end $phone_check$;

-- ───────────────────────────────── RLS ───────────────────────────────────────

alter table public.flows                 enable row level security;
alter table public.flow_versions         enable row level security;
alter table public.flow_executions       enable row level security;
alter table public.flow_execution_events enable row level security;

drop policy if exists tenant_isolation_flows_all on public.flows;
create policy tenant_isolation_flows_all on public.flows
  for all
  using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin())
  with check (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin());

drop policy if exists tenant_isolation_flow_versions_all on public.flow_versions;
create policy tenant_isolation_flow_versions_all on public.flow_versions
  for all
  using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin())
  with check (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin());

drop policy if exists tenant_isolation_flow_executions_all on public.flow_executions;
create policy tenant_isolation_flow_executions_all on public.flow_executions
  for all
  using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin())
  with check (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin());

drop policy if exists tenant_isolation_flow_execution_events_all on public.flow_execution_events;
create policy tenant_isolation_flow_execution_events_all on public.flow_execution_events
  for all
  using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin())
  with check (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin());

revoke all on public.flows                 from anon, public;
revoke all on public.flow_versions         from anon, public;
revoke all on public.flow_executions       from anon, public;
revoke all on public.flow_execution_events from anon, public;

grant select, insert, update, delete on public.flows           to authenticated;
grant select, insert, update, delete on public.flow_versions   to authenticated;
grant select, insert, update, delete on public.flow_executions to authenticated;
grant select, insert                 on public.flow_execution_events to authenticated;

-- ───────────────────────────── o claim ───────────────────────────────────────
--
-- Cópia deliberada de `fn_claim_due_followup_enrollments` NA VERSÃO JUSTA
-- (migration 0146): rodízio por organização, para uma org com fila grande não
-- monopolizar o lote. Duas armadilhas herdadas com o desenho, as duas comentadas
-- onde importam:
--
--   1. `for update skip locked` NÃO convive com window function na mesma query —
--      por isso a CTE `travados` é separada.
--   2. `skip locked` sozinho NÃO impede duas conexões de reclamarem a mesma
--      linha: as duas materializam a lista de candidatos ANTES de qualquer lock
--      existir, e a segunda, ao ganhar o lock, reavalia apenas o WHERE do UPDATE
--      (READ COMMITTED). Por isso a condição de lease está REPETIDA no UPDATE.

create or replace function public.fn_claim_due_flow_executions(p_limit int, p_lease_seconds int)
returns setof public.flow_executions
language sql
security definer
set search_path = public
as $claim$
  with orgs as (
    select distinct organization_id
      from public.flow_executions
     where status in ('pending','running','waiting')
       and next_eval_at <= now()
  ),
  fila as (
    select f.id, f.next_eval_at, f.posicao_na_org
      from orgs
      cross join lateral (
        select d.id,
               d.next_eval_at,
               row_number() over (order by d.next_eval_at) as posicao_na_org
          from public.flow_executions d
         where d.organization_id = orgs.organization_id
           and d.status in ('pending','running','waiting')
           and d.next_eval_at <= now()
           and (d.claimed_until is null or d.claimed_until < now())
         order by d.next_eval_at
         limit p_limit
      ) f
  ),
  escolhidos as (
    -- Posição 1 de todas as organizações, depois a 2 de todas. Empate na mesma
    -- posição vai para quem esperou mais.
    select id from fila order by posicao_na_org, next_eval_at limit p_limit
  ),
  travados as (
    select e.id from public.flow_executions e
     where e.id in (select id from escolhidos)
     for update skip locked
  )
  update public.flow_executions e
     set claimed_until = now() + make_interval(secs => p_lease_seconds),
         updated_at = now()
   where e.id in (select id from travados)
     -- REPETIDA de propósito — ver o item 2 do cabeçalho acima.
     and (e.claimed_until is null or e.claimed_until < now())
  returning e.*;
$claim$;

-- Função em `public` nasce EXPOSTA por DUAS origens distintas, e tratar só uma
-- deixa a RPC alcançável pela anon key: (A) o `alter default privileges ... to anon`
-- do baseline, que `revoke from public` não remove; (B) o grant a PUBLIC que o
-- Postgres dá a toda função ao criá-la, que `revoke from anon` não remove.
revoke execute on function public.fn_claim_due_flow_executions(int, int) from public, anon, authenticated;
grant execute on function public.fn_claim_due_flow_executions(int, int) to service_role;
