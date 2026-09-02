-- 0207 — Flow Engine: da frente ÚNICA às múltiplas frentes.
--
-- ═══ O que esta migration destrava ═══
--
-- A 0203 nasceu com UM cursor por execução, e disse isso na cara: a coluna
-- `flow_executions.current_node_id text not null` é uma string só, e
-- `docs/flow-engine/architecture.md` lista paralelo, JOIN e subfluxo como fora
-- de escopo "porque N ramos pedem migration e reescrita do tick". Esta é a
-- migration, e o tick vem no commit seguinte.
--
-- Decisão do dono do produto: o construtor precisa virar motor de orquestração
-- — paralelo, laço, sub-fluxo, espera por evento e barramento interno.
--
-- ═══ O desenho: a frente vira LINHA ═══
--
-- O cursor sai da execução e vira `flow_execution_frames`. Uma execução com
-- quatro ramos paralelos passa a ter quatro frames `ready`. O que era escalar
-- (`current_node_id`, `steps_taken`) passa a ser por frente; o que é do
-- processo inteiro (`context`, o sujeito, o desfecho) fica na execução.
--
-- ⚠️ `current_node_id` NÃO é apagada. Vira legado de leitura, e o backfill
-- abaixo dá um frame a cada execução viva. Apagar coluna no meio do caminho
-- quebra o `update.sh` de um clone que esteja com fluxo rodando — e a doutrina
-- de migrations manda a mudança ser auto-curativa, não destrutiva.
--
-- ═══ Por que `integer` e não `smallint` em `steps_taken` ═══
--
-- A 0203 usou `smallint` (teto 32767) num mundo sem laço. Com `logic.for_each`
-- sobre uma lista de mil itens o teto passa a ser alcançável, e estourar um
-- smallint é erro de banco no meio de uma execução, não um limite educado.

-- ─────────────────────── flow_execution_frames ──────────────────────────────
--
-- `parent_frame_id` existe para o fork saber de quem nasceu, e para o cancelamento
-- de irmãos (modo 'primeira') ter como varrer a subárvore.
--
-- `vars` é o espaço LOCAL da frente. É o que impede dois ramos paralelos de se
-- sobrescreverem: `advance` com `vars` fora de fork grava no `context` da
-- execução (compartilhado); dentro de um fork, grava aqui.

create table if not exists public.flow_execution_frames (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  execution_id        uuid not null references public.flow_executions(id) on delete cascade,
  parent_frame_id     uuid references public.flow_execution_frames(id) on delete cascade,
  node_id             text not null,
  status              text not null default 'ready',
  next_eval_at        timestamptz,
  claimed_until       timestamptz,
  steps_taken         integer not null default 0,
  vars                jsonb not null default '{}'::jsonb,
  fork_node_id        text,
  awaiting_event_type text,
  awaiting_match      jsonb,
  wait_deadline       timestamptz,
  loop_node_id        text,
  loop_index          integer,
  loop_total          integer,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

do $frames_checks$ begin
  alter table public.flow_execution_frames drop constraint if exists flow_execution_frames_status_check;
  alter table public.flow_execution_frames add constraint flow_execution_frames_status_check
    check (status in ('ready','waiting','done','cancelled'));

  -- Mesmo cinto do `flow_executions_clock_check` da 0203: estado com relógio TEM
  -- `next_eval_at`; estado terminal NÃO. Coerência no schema, não na prosa.
  --
  -- `waiting` é o caso interessante: uma frente pode esperar por TEMPO
  -- (`next_eval_at` preenchido) ou por EVENTO (`awaiting_event_type` preenchido,
  -- e aí `next_eval_at` carrega o `wait_deadline`, que é o timeout). O que não
  -- pode existir é `waiting` sem nenhum dos dois — seria uma frente que nada no
  -- sistema jamais acorda, e o sintoma disso é um fluxo parado para sempre sem
  -- linha de erro em lugar nenhum.
  alter table public.flow_execution_frames drop constraint if exists flow_execution_frames_clock_check;
  alter table public.flow_execution_frames add constraint flow_execution_frames_clock_check
    check (
      (status = 'ready'   and next_eval_at is not null)
      or (status = 'waiting' and (next_eval_at is not null or awaiting_event_type is not null))
      or (status in ('done','cancelled'))
    );

  -- Laço declarado é laço com teto. `loop_index`/`loop_total` andam juntos, e
  -- um `loop_node_id` sem eles seria um laço sem condição de parada.
  alter table public.flow_execution_frames drop constraint if exists flow_execution_frames_loop_check;
  alter table public.flow_execution_frames add constraint flow_execution_frames_loop_check
    check (
      (loop_node_id is null and loop_index is null and loop_total is null)
      or (loop_node_id is not null and loop_index is not null and loop_total is not null
          and loop_index >= 0 and loop_total >= 0)
    );
end $frames_checks$;

-- O claim varre por relógio; o índice parcial é o mesmo padrão da 0203.
create index if not exists idx_flow_frames_due
  on public.flow_execution_frames (next_eval_at)
  where status in ('ready','waiting');

create index if not exists idx_flow_frames_due_por_org
  on public.flow_execution_frames (organization_id, next_eval_at)
  where status in ('ready','waiting');

-- A retomada por evento é uma busca por `awaiting_event_type`, e ela roda no
-- caminho do drain do event_log — que é 1×/min e já carrega o resto do produto.
create index if not exists idx_flow_frames_esperando_evento
  on public.flow_execution_frames (organization_id, awaiting_event_type)
  where status = 'waiting' and awaiting_event_type is not null;

create index if not exists idx_flow_frames_da_execucao
  on public.flow_execution_frames (execution_id, status);

-- ──────────────────────── flow_execution_joins ──────────────────────────────
--
-- O encontro dos ramos. `esperadas` é gravado pelo fork (quantos frames ele
-- criou) e `chegadas` sobe a cada frame que alcança o `join_node_id`.
--
-- `modo`:
--   'todas'    — o merge só segue quando `chegadas = esperadas`. É o AND.
--   'primeira' — o primeiro frame a chegar vence e os irmãos viram 'cancelled'.
--                É o "esperar o primeiro entre vários" (cliente responder OU
--                pagamento cair OU 24h passarem).
--
-- `unique (execution_id, fork_node_id)` é o que torna o fork idempotente: o
-- motor pode revisitar o nó de fork num retry sem duplicar a contagem.

create table if not exists public.flow_execution_joins (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  execution_id     uuid not null references public.flow_executions(id) on delete cascade,
  fork_node_id     text not null,
  join_node_id     text not null,
  modo             text not null,
  esperadas        integer not null,
  chegadas         integer not null default 0,
  resolvido_em     timestamptz,
  created_at       timestamptz not null default now()
);

do $joins_checks$ begin
  alter table public.flow_execution_joins drop constraint if exists flow_execution_joins_modo_check;
  alter table public.flow_execution_joins add constraint flow_execution_joins_modo_check
    check (modo in ('todas','primeira'));

  -- Contagem que passa do esperado é defeito de motor, e é melhor descobrir no
  -- INSERT do que numa tela que diz que o fluxo terminou duas vezes.
  alter table public.flow_execution_joins drop constraint if exists flow_execution_joins_contagem_check;
  alter table public.flow_execution_joins add constraint flow_execution_joins_contagem_check
    check (esperadas > 0 and chegadas >= 0 and chegadas <= esperadas);
end $joins_checks$;

create unique index if not exists uniq_flow_joins_fork
  on public.flow_execution_joins (execution_id, fork_node_id);

create index if not exists idx_flow_joins_da_execucao
  on public.flow_execution_joins (execution_id);

-- ───────────────────── flow_executions: o que muda ──────────────────────────
--
-- Tudo aditivo. Clone com execução em voo continua funcionando durante e depois.

alter table public.flow_executions add column if not exists subject_kind text not null default 'lead';
alter table public.flow_executions add column if not exists parent_execution_id uuid;
alter table public.flow_executions add column if not exists parent_frame_id uuid;
alter table public.flow_executions add column if not exists input  jsonb not null default '{}'::jsonb;
alter table public.flow_executions add column if not exists output jsonb not null default '{}'::jsonb;

do $exec_novas$ begin
  -- FKs em passo separado: `add column ... references` não é idempotente com
  -- `if not exists`, e re-aplicar (o `update.sh` do clone) daria erro de
  -- constraint duplicada.
  if not exists (
    select 1 from pg_constraint
     where conname = 'flow_executions_parent_execution_fk'
       and conrelid = 'public.flow_executions'::regclass
  ) then
    alter table public.flow_executions
      add constraint flow_executions_parent_execution_fk
      foreign key (parent_execution_id) references public.flow_executions(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'flow_executions_parent_frame_fk'
       and conrelid = 'public.flow_executions'::regclass
  ) then
    alter table public.flow_executions
      add constraint flow_executions_parent_frame_fk
      foreign key (parent_frame_id) references public.flow_execution_frames(id) on delete set null;
  end if;

  -- O sujeito polimórfico. `none` é o caso dos gatilhos que não têm dono no CRM
  -- — webhook de terceiro, horário, evento interno.
  alter table public.flow_executions drop constraint if exists flow_executions_subject_kind_check;
  alter table public.flow_executions add constraint flow_executions_subject_kind_check
    check (subject_kind in ('lead','contact','conversation','none'));
end $exec_novas$;

-- `smallint` (teto 32767) foi escolhido num mundo sem laço. `alter type` é
-- idempotente na prática: repetir para uma coluna que já é `integer` é no-op.
do $exec_steps$ begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'flow_executions'
       and column_name = 'steps_taken' and data_type = 'smallint'
  ) then
    alter table public.flow_executions alter column steps_taken type integer;
  end if;
end $exec_steps$;

-- `current_node_id` deixa de ser obrigatória: a partir daqui quem carrega o
-- cursor é o frame. A coluna fica, preenchida, como legado de leitura para a
-- tela de execuções que já a mostra.
do $exec_cursor$ begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'flow_executions'
       and column_name = 'current_node_id' and is_nullable = 'NO'
  ) then
    alter table public.flow_executions alter column current_node_id drop not null;
  end if;
end $exec_cursor$;

create index if not exists idx_flow_executions_filha
  on public.flow_executions (parent_execution_id)
  where parent_execution_id is not null;

-- ───────────────────────────── O BACKFILL ───────────────────────────────────
--
-- ⚠️ ISTO NÃO É OPCIONAL, e não é enfeite de migration.
--
-- A partir do commit seguinte o motor só enxerga frames. Uma execução viva que
-- não ganhar frame aqui simplesmente PARA — sem erro, sem linha em lugar
-- nenhum, e o dono da instalação descobre pelo cliente que não foi atendido.
--
-- Idempotente pelo `not exists`: re-aplicar (o `update.sh`) não duplica frame.
insert into public.flow_execution_frames
  (organization_id, execution_id, node_id, status, next_eval_at, steps_taken, vars)
select e.organization_id,
       e.id,
       e.current_node_id,
       case when e.status = 'waiting' then 'waiting' else 'ready' end,
       -- O CHECK exige relógio em 'ready' e em 'waiting' sem evento. Execução
       -- pausada não tem `next_eval_at` (o clock_check da 0203 garante), então
       -- ela entra como 'ready' com o relógio de agora: ao despausar, anda.
       coalesce(e.next_eval_at, now()),
       coalesce(e.steps_taken, 0),
       '{}'::jsonb
  from public.flow_executions e
 where e.status in ('pending','running','waiting','paused')
   and e.current_node_id is not null
   and not exists (
     select 1 from public.flow_execution_frames f where f.execution_id = e.id
   );

-- ──────────────── webhook_sources: o gatilho por webhook ────────────────────
--
-- `kind` estava travado em 'lead_capture' pelo CHECK da 0038, e `/webhooks/in/`
-- é especializado em captação: cria lead e emite `lead.created`. Um receptor
-- que emita `event_type` arbitrário para armar fluxo precisa de um kind próprio
-- — senão o gatilho de webhook fica desenhável na tela e nunca dispara, que é
-- exatamente o que `docs/flow-engine/creating-new-node.md` proíbe.
do $webhook_kind$ begin
  -- O baseline cria o CHECK INLINE (`kind text ... check (kind in ('lead_capture'))`,
  -- baseline.sql:5907), e o Postgres o nomeia `<tabela>_<coluna>_check`. A busca é
  -- escopada por `conrelid` porque `conname` não é único no catálogo inteiro.
  if exists (
    select 1 from pg_constraint
     where conname = 'webhook_sources_kind_check'
       and conrelid = 'public.webhook_sources'::regclass
  ) then
    alter table public.webhook_sources drop constraint webhook_sources_kind_check;
  end if;
  alter table public.webhook_sources add constraint webhook_sources_kind_check
    check (kind in ('lead_capture','flow_trigger'));
end $webhook_kind$;

-- ─────────────────────────── RLS e grants ───────────────────────────────────
--
-- Espelha a 0205, não a 0203: policy `for all` com `fn_role_at_least(..., 'manager')`.
-- `tests/invariants/rbac-config-ia-canais.test.ts` reprova tabela NOVA que entre
-- com policy ALL só-tenancy, e foi assim que a 0203 precisou de forward-fix.

alter table public.flow_execution_frames enable row level security;
alter table public.flow_execution_joins  enable row level security;

drop policy if exists tenant_isolation_flow_execution_frames_all on public.flow_execution_frames;
create policy tenant_isolation_flow_execution_frames_all on public.flow_execution_frames
  for all using (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'manager'))
    or public.fn_is_platform_admin()
  ) with check (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'manager'))
    or public.fn_is_platform_admin()
  );

drop policy if exists tenant_isolation_flow_execution_joins_all on public.flow_execution_joins;
create policy tenant_isolation_flow_execution_joins_all on public.flow_execution_joins
  for all using (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'manager'))
    or public.fn_is_platform_admin()
  ) with check (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'manager'))
    or public.fn_is_platform_admin()
  );

revoke all on public.flow_execution_frames from anon, public;
revoke all on public.flow_execution_joins  from anon, public;

-- `select` apenas: a tela de execuções lê a trilha; quem ESCREVE frame é o
-- worker, com a service key. Espelha `flow_execution_events` da 0203, que dá
-- só `select, insert` — aqui nem insert, porque não há caminho de UI que crie
-- uma frente à mão.
grant select on public.flow_execution_frames to authenticated;
grant select on public.flow_execution_joins  to authenticated;

-- ────────────────────────── o claim de FRENTES ──────────────────────────────
--
-- Substitui `fn_claim_due_flow_executions`. Mesmo desenho da 0203 — rodízio por
-- organização, `for update skip locked`, condição de lease REPETIDA no UPDATE —
-- com uma diferença que não é cosmética:
--
-- ⚠️ O rodízio agora é por EXECUÇÃO, não só por organização. Dois frames da
-- mesma execução processados no mesmo lote escreveriam no MESMO
-- `flow_executions.context`, e o segundo sobrescreveria o primeiro — perda
-- silenciosa de variável, que é o pior defeito que um motor de automação pode
-- ter, porque o fluxo continua e entrega o resultado errado. `distinct on
-- (execution_id)` garante no máximo um frame por execução por lote; os irmãos
-- vêm no tick seguinte, um minuto depois.
--
-- O preço está dito: um fork de 4 ramos leva 4 minutos para andar um passo em
-- cada ramo. É o preço de não perder variável, e é reversível quando o `context`
-- deixar de ser um objeto só (não nesta entrega).

create or replace function public.fn_claim_due_flow_frames(p_limit int, p_lease_seconds int)
returns setof public.flow_execution_frames
language sql
security definer
set search_path = public
as $claim_frames$
  with orgs as (
    select distinct organization_id
      from public.flow_execution_frames
     where status in ('ready','waiting')
       and next_eval_at <= now()
  ),
  fila as (
    select f.id, f.execution_id, f.next_eval_at, f.posicao_na_org
      from orgs
      cross join lateral (
        select d.id,
               d.execution_id,
               d.next_eval_at,
               row_number() over (order by d.next_eval_at) as posicao_na_org
          from public.flow_execution_frames d
         where d.organization_id = orgs.organization_id
           and d.status in ('ready','waiting')
           and d.next_eval_at <= now()
           and (d.claimed_until is null or d.claimed_until < now())
         order by d.next_eval_at
         limit p_limit
      ) f
  ),
  -- Um frame por execução, o mais antigo. Ver o parágrafo sobre o `context`.
  uma_por_execucao as (
    select distinct on (execution_id) id, next_eval_at, posicao_na_org
      from fila
     order by execution_id, next_eval_at, id
  ),
  escolhidos as (
    select id from uma_por_execucao order by posicao_na_org, next_eval_at limit p_limit
  ),
  travados as (
    select f.id from public.flow_execution_frames f
     where f.id in (select id from escolhidos)
     for update skip locked
  )
  update public.flow_execution_frames f
     set claimed_until = now() + make_interval(secs => p_lease_seconds),
         updated_at = now()
   where f.id in (select id from travados)
     -- REPETIDA de propósito — `skip locked` sozinho não impede duas conexões
     -- de reclamarem a mesma linha sob READ COMMITTED. Ver o cabeçalho da 0203.
     and (f.claimed_until is null or f.claimed_until < now())
  returning f.*;
$claim_frames$;

-- Função em `public` nasce EXPOSTA por DUAS origens, e tratar só uma deixa a RPC
-- alcançável pela anon key: (A) o `alter default privileges ... to anon` do
-- baseline, que `revoke from public` não remove; (B) o grant a PUBLIC que o
-- Postgres dá a toda função ao criá-la, que `revoke from anon` não remove.
revoke execute on function public.fn_claim_due_flow_frames(int, int) from public, anon, authenticated;
grant  execute on function public.fn_claim_due_flow_frames(int, int) to service_role;
