-- ============================================================================
-- 0245 — A AGENDA PASSA A SER DE PROFISSIONAIS, E NÃO SÓ DE QUEM TEM LOGIN
--
-- Até aqui, "de quem é este horário" era `owner_user_id`: um usuário do
-- sistema. Medido no pedido do dono do produto (clínica de estética): a
-- esteticista que atende NÃO tem login — quem marca é a recepção e a IA. Criar
-- usuário para ela ocuparia vaga, exigiria e-mail e daria a ela uma tela que
-- ela não usa. E um procedimento às vezes ocupa DUAS pessoas (quem faz e quem
-- auxilia), e o horário só existe se as duas estiverem livres.
--
-- ─── UNIFICAR: toda pessoa agendável é uma linha em `calendar_professionals`
-- `user_id` é OPCIONAL. Quem tem login vira profissional COM `user_id` (e a
-- jornada continua lida de `attendant_availability.schedule` — nada é
-- duplicado); quem não tem guarda a própria jornada em `schedule`. A CHECK
-- `calendar_professionals_jornada_tem_uma_fonte` impede as duas fontes ao
-- mesmo tempo, que é o anti-pattern nº 2 do CLAUDE.md.
--
-- `calendar_appointments.owner_user_id` CONTINUA, e continua = o `user_id` da
-- profissional principal (ou NULL quando ela não tem login). O push ao Google,
-- o índice de duplicata da 0182 e a LGPD da 0184 seguem iguais, porque nenhum
-- deles precisa saber que a pessoa mudou de tabela.
--
-- ─── Quem atende é uma tabela, e o horário dela é ESPELHO ─────────────────
-- `calendar_appointment_professionals` diz quem atende cada agendamento
-- (`principal` e, quando o tipo pede duas, `apoio`). Ela carrega uma cópia de
-- `starts_at`/`ends_at`/`status`, e a cópia existe por uma razão só: o índice
-- único `cap_sem_duplicata_idx` precisa das três colunas NA MESMA LINHA para
-- impedir a mesma profissional em dois agendamentos vivos no mesmo instante —
-- como principal num e apoio no outro, que é o caso que o índice antigo (por
-- `owner_user_id`) não enxerga. A fonte é `calendar_appointments`; quem mantém
-- a cópia é o trigger `trg_agenda_participantes_acompanham`, e por isso
-- remarcar em cima da apoio falha com 23505 no MESMO UPDATE que remarca.
--
-- `status` aqui NÃO tem CHECK: é espelho, e um CHECK nele seria a segunda lista
-- do mesmo vocabulário (a primeira é `calendar_appointments_status_check`).
--
-- ─── FK composta (organization_id, id), e por quê ─────────────────────────
-- As três tabelas novas referenciam tipo, agendamento e profissional por
-- `(organization_id, id)`. Com FK só por `id`, uma linha poderia apontar para o
-- profissional de OUTRA organização e a RLS (que olha a `organization_id` da
-- própria linha) não perceberia. A composta faz o banco recusar (23503). Os
-- índices únicos `(organization_id, id)` nascem PRIMEIRO, porque FK exige
-- índice único no alvo.
--
-- `cap_profissional_fk` é NO ACTION, e não RESTRICT, de propósito: apagar a
-- organização apaga participantes (cascade direto por `organization_id`) e
-- profissionais no mesmo statement; NO ACTION confere no FIM do statement e
-- passa, RESTRICT confere na hora e quebraria o delete de organização
-- (`tests/invariants/deletar-org-e-agente.test.ts`). Fora disso, apagar
-- profissional que já atendeu é recusado — desativa-se (`is_active = false`).
--
-- ─── RLS ───────────────────────────────────────────────────────────────────
-- Mesma divisão da 0177, e nenhuma policy `for all` só-tenancy (a catraca de
-- `rbac-config-ia-canais` está certa): profissionais e serviços por
-- profissional são CONFIGURAÇÃO — lê membro, escreve manager+; quem atende cada
-- agendamento é OPERAÇÃO — lê membro, escreve agent+, igual a
-- `calendar_appointments`.
--
-- ─── Backfill genérico e auto-curativo ─────────────────────────────────────
-- Toda pessoa que JÁ aparece na agenda vira profissional: dono padrão de tipo,
-- dono de agendamento, dono de exceção, dono de conexão do Google e quem tem
-- jornada publicada. Depois, cada tipo habilita o seu dono padrão, cada
-- agendamento ganha a principal, e cada exceção aponta para o profissional.
-- Nada usa id de organização; tudo é `on conflict do nothing` ou guardado por
-- `not exists`, para o `update.sh` poder re-aplicar sem duplicar e SEM DESFAZER
-- escolha de operador (habilitação só entra em tipo que não tem nenhuma).
--
-- Funções novas são `security invoker` — a RLS de quem chama vale dentro delas
-- — e revogam as duas origens de EXECUTE (public e anon), como manda a
-- doutrina de migrations.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 0 · chaves compostas para FK que não atravessa organização (PRIMEIRO)
-- ────────────────────────────────────────────────────────────────────────────
create unique index if not exists calendar_event_types_org_id_key
  on public.calendar_event_types (organization_id, id);
create unique index if not exists calendar_appointments_org_id_key
  on public.calendar_appointments (organization_id, id);

-- ────────────────────────────────────────────────────────────────────────────
-- 1 · os profissionais — com ou sem login
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.calendar_professionals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- NULL = a profissional não tem login. `set null`: o usuário sumir não apaga
  -- quem atendeu.
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  -- Mesma régua de `user_organizations.calendar_trilha` (0186): a COR mora no
  -- CSS, por tema; aqui só o número da trilha.
  trilha smallint,
  is_active boolean not null default true,
  -- SÓ para quem não tem login. Mesmo shape de `availabilityScheduleSchema`
  -- ({timezone, windows[{dow,start,end}]}), lido pelo mesmo `lerJornadaDoBanco`.
  schedule jsonb,
  -- `numeric`, nunca `int`: lista arrastável (fractional indexing).
  position numeric not null default 1000,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_professionals_nome_valido
    check (char_length(btrim(name)) between 1 and 120),
  constraint calendar_professionals_trilha_valida
    check (trilha is null or trilha between 1 and 8),
  constraint calendar_professionals_jornada_tem_uma_fonte
    check (user_id is null or schedule is null)
);

create unique index if not exists calendar_professionals_org_id_key
  on public.calendar_professionals (organization_id, id);
-- Um membro é UM profissional por organização.
create unique index if not exists calendar_professionals_membro_key
  on public.calendar_professionals (organization_id, user_id)
  where user_id is not null;
create index if not exists calendar_professionals_org_ativos_idx
  on public.calendar_professionals (organization_id, position)
  where is_active;

comment on table public.calendar_professionals is
  'Quem atende na agenda, com ou sem login. user_id preenchido = membro da equipe (jornada em attendant_availability.schedule); user_id NULL = profissional sem acesso ao sistema (jornada em schedule). Desativar (is_active=false), nunca apagar: quem já atendeu é referenciado por calendar_appointment_professionals.';
comment on column public.calendar_professionals.schedule is
  'Jornada semanal de quem NÃO tem login, no shape de availabilityScheduleSchema. Para quem tem login fica NULL (CHECK calendar_professionals_jornada_tem_uma_fonte): a jornada dele é attendant_availability.schedule, e duas fontes divergiriam.';
comment on column public.calendar_professionals.trilha is
  'Trilha de cor (1..8) na grade. NULL = derivada (trilhasDaEquipe). A cor de cada trilha vive em app/globals.css, por tema.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2 · que serviço cada profissional faz
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.calendar_event_type_professionals (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_type_id uuid not null,
  professional_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (event_type_id, professional_id),
  constraint cetp_tipo_fk foreign key (organization_id, event_type_id)
    references public.calendar_event_types (organization_id, id) on delete cascade,
  constraint cetp_profissional_fk foreign key (organization_id, professional_id)
    references public.calendar_professionals (organization_id, id) on delete cascade
);

create index if not exists cetp_org_profissional_idx
  on public.calendar_event_type_professionals (organization_id, professional_id);

comment on table public.calendar_event_type_professionals is
  'Quais profissionais fazem cada tipo de agendamento. Tipo SEM nenhuma linha aqui = qualquer profissional ativa (ou o dono padrão do tipo), para instalação antiga não perder horário.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3 · quem atende cada agendamento — horário e situação ESPELHADOS
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.calendar_appointment_professionals (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  appointment_id uuid not null,
  professional_id uuid not null,
  role text not null default 'principal',
  -- Espelho de calendar_appointments, mantido por trg_agenda_participantes_acompanham.
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- Espelho, SEM CHECK: o vocabulário é o de calendar_appointments_status_check.
  status text not null,
  created_at timestamptz not null default now(),
  primary key (appointment_id, professional_id),
  constraint calendar_appointment_professionals_role_check
    check (role in ('principal', 'apoio')),
  constraint cap_compromisso_fk foreign key (organization_id, appointment_id)
    references public.calendar_appointments (organization_id, id) on delete cascade,
  -- NO ACTION, não RESTRICT — ver o cabeçalho.
  constraint cap_profissional_fk foreign key (organization_id, professional_id)
    references public.calendar_professionals (organization_id, id)
);

-- Uma principal por agendamento.
create unique index if not exists cap_um_principal_key
  on public.calendar_appointment_professionals (appointment_id)
  where role = 'principal';
-- A guarda de duplicata POR PESSOA, seja ela principal ou apoio. Mesma régua da
-- 0182: coincidência exata de instante, nunca sobreposição (o encaixe continua
-- permitido), e só nas situações que ocupam.
create unique index if not exists cap_sem_duplicata_idx
  on public.calendar_appointment_professionals (organization_id, professional_id, starts_at)
  where status in ('pending', 'confirmed');
create index if not exists cap_agenda_idx
  on public.calendar_appointment_professionals (organization_id, professional_id, starts_at);

comment on table public.calendar_appointment_professionals is
  'Quem atende cada agendamento: uma principal e, quando o tipo pede duas, uma apoio. starts_at/ends_at/status são ESPELHO de calendar_appointments (trigger trg_agenda_participantes_acompanham) e existem para o índice cap_sem_duplicata_idx impedir a mesma profissional em dois agendamentos vivos no mesmo instante.';

-- ────────────────────────────────────────────────────────────────────────────
-- 4 · o espelho acompanha o agendamento
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.fn_agenda_participantes_acompanham()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
begin
  -- Remarcar em cima de um horário em que a principal OU a apoio já está vira
  -- 23505 (cap_sem_duplicata_idx) aqui dentro, e o UPDATE inteiro desfaz.
  update public.calendar_appointment_professionals
     set starts_at = new.starts_at,
         ends_at   = new.ends_at,
         status    = new.status
   where organization_id = new.organization_id
     and appointment_id = new.id;
  return new;
end
$fn$;

-- Função de trigger não exige EXECUTE de quem dispara o UPDATE.
revoke execute on function public.fn_agenda_participantes_acompanham() from public, anon, authenticated;
grant  execute on function public.fn_agenda_participantes_acompanham() to service_role;

drop trigger if exists trg_agenda_participantes_acompanham on public.calendar_appointments;
create trigger trg_agenda_participantes_acompanham
  after update of starts_at, ends_at, status on public.calendar_appointments
  for each row
  when (old.starts_at is distinct from new.starts_at
        or old.ends_at is distinct from new.ends_at
        or old.status is distinct from new.status)
  execute function public.fn_agenda_participantes_acompanham();

-- ────────────────────────────────────────────────────────────────────────────
-- 5 · marcar é atômico: o agendamento e quem atende entram juntos
-- ────────────────────────────────────────────────────────────────────────────
-- Dois INSERTs separados pelo PostgREST deixariam uma janela em que o
-- agendamento existe sem profissional — e o 23505 da apoio chegaria DEPOIS do
-- agendamento gravado. Aqui é uma transação: 23505 de qualquer das duas
-- tabelas desfaz tudo, e a rota devolve 409.
--
-- As colunas do agendamento vêm de uma LISTA FECHADA (`v_permitidas`): só as
-- chaves presentes em `p_compromisso` entram no INSERT, e as ausentes ficam com
-- o DEFAULT da tabela — sem repetir os defaults aqui. `organization_id` vem do
-- parâmetro, nunca do jsonb; google_*, reminder_* e id não são graváveis por
-- esta porta.
create or replace function public.fn_agenda_marcar(
  p_organization_id uuid,
  p_compromisso jsonb,
  p_profissionais uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  v_permitidas constant text[] := array[
    'event_type_id', 'title', 'description', 'starts_at', 'ends_at', 'time_zone',
    'status', 'owner_user_id', 'contact_id', 'conversation_id', 'location_kind',
    'location_details', 'meeting_url', 'notes', 'rescheduled_from_id',
    'created_by_kind', 'created_by_user_id', 'created_by_agent_id', 'source'
  ];
  v_colunas text;
  v_id uuid;
begin
  if p_profissionais is null
     or cardinality(p_profissionais) < 1
     or cardinality(p_profissionais) > 2 then
    raise exception 'fn_agenda_marcar: um agendamento tem 1 ou 2 profissionais (recebeu %)',
      coalesce(cardinality(p_profissionais), 0)
      using errcode = '22023';
  end if;
  -- Repetida ou nula cairia na PK como 23505, que a rota lê como "horário
  -- ocupado" — mentira. Recusa aqui, com o código de argumento inválido.
  if array_position(p_profissionais, null) is not null
     or (select count(distinct x) from unnest(p_profissionais) as x) <> cardinality(p_profissionais) then
    raise exception 'fn_agenda_marcar: profissional repetida ou nula em %', p_profissionais
      using errcode = '22023';
  end if;
  if p_compromisso is null or jsonb_typeof(p_compromisso) <> 'object' then
    raise exception 'fn_agenda_marcar: p_compromisso precisa ser um objeto jsonb'
      using errcode = '22023';
  end if;

  select string_agg(format('%I', k.coluna), ', ' order by k.ordem)
    into v_colunas
    from unnest(v_permitidas) with ordinality as k(coluna, ordem)
   where p_compromisso ? k.coluna;
  if v_colunas is null then
    raise exception 'fn_agenda_marcar: p_compromisso sem nenhuma coluna conhecida'
      using errcode = '22023';
  end if;

  execute format(
    'insert into public.calendar_appointments (organization_id, %1$s)
     select $1, %1$s from jsonb_populate_record(null::public.calendar_appointments, $2)
     returning id',
    v_colunas)
    into v_id
    using p_organization_id, p_compromisso;

  -- 1ª da lista = principal; a 2ª, se houver, apoio. A FK composta recusa
  -- profissional de outra organização (23503).
  insert into public.calendar_appointment_professionals
    (organization_id, appointment_id, professional_id, role, starts_at, ends_at, status)
  select a.organization_id, a.id, p.professional_id,
         case when p.ordem = 1 then 'principal' else 'apoio' end,
         a.starts_at, a.ends_at, a.status
    from public.calendar_appointments a
   cross join unnest(p_profissionais) with ordinality as p(professional_id, ordem)
   where a.id = v_id
     and a.organization_id = p_organization_id;

  return v_id;
end
$fn$;

revoke execute on function public.fn_agenda_marcar(uuid, jsonb, uuid[]) from public, anon;
grant  execute on function public.fn_agenda_marcar(uuid, jsonb, uuid[]) to authenticated, service_role;

comment on function public.fn_agenda_marcar(uuid, jsonb, uuid[]) is
  'Marca um agendamento e grava quem atende, atomicamente. p_profissionais: 1 ou 2, a primeira é a principal. security invoker: a RLS de quem chama vale aqui dentro. 23505 (de calendar_appointments ou de calendar_appointment_professionals) = horário ocupado; 23503 = profissional de outra organização; 22023 = argumento inválido.';

-- ────────────────────────────────────────────────────────────────────────────
-- 6 · exceções por data passam a ser de PROFISSIONAL
-- ────────────────────────────────────────────────────────────────────────────
alter table public.calendar_availability_exceptions
  add column if not exists professional_id uuid;

alter table public.calendar_availability_exceptions
  drop constraint if exists calendar_availability_exceptions_profissional_fk;
alter table public.calendar_availability_exceptions
  add constraint calendar_availability_exceptions_profissional_fk
  foreign key (organization_id, professional_id)
  references public.calendar_professionals (organization_id, id) on delete cascade;

-- Profissional sem login não tem user_id. Quem tem continua gravando user_id
-- junto, e a policy self-OU-manager+ da 0177 segue valendo para ele.
alter table public.calendar_availability_exceptions
  alter column user_id drop not null;

alter table public.calendar_availability_exceptions
  drop constraint if exists calendar_exceptions_tem_dono;
alter table public.calendar_availability_exceptions
  add constraint calendar_exceptions_tem_dono
  check (professional_id is not null or user_id is not null);

comment on column public.calendar_availability_exceptions.professional_id is
  'De qual profissional é a exceção. Para quem tem login, user_id é gravado junto (a policy de escrita self-OU-manager+ lê user_id); para quem não tem, user_id fica NULL e só manager+ escreve.';

-- ────────────────────────────────────────────────────────────────────────────
-- 7 · quantas profissionais o tipo pede
-- ────────────────────────────────────────────────────────────────────────────
alter table public.calendar_event_types
  add column if not exists professionals_required smallint not null default 1;

alter table public.calendar_event_types
  drop constraint if exists calendar_event_types_profissionais_sensato;
alter table public.calendar_event_types
  add constraint calendar_event_types_profissionais_sensato
  check (professionals_required between 1 and 2);

comment on column public.calendar_event_types.professionals_required is
  '1 = uma profissional atende; 2 = principal + apoio, e o horário só existe se as duas estiverem livres.';

-- ────────────────────────────────────────────────────────────────────────────
-- 8 · o lembrete entra pela fila de mensagens agendadas
-- ────────────────────────────────────────────────────────────────────────────
-- Nenhum caminho de envio novo: o cron `scheduled-messages` já cuida de janela,
-- espaçamento, opt-out, situação e aviso de falha. A agenda só aponta para a
-- mensagem que entregou à fila.
alter table public.calendar_appointments
  add column if not exists reminder_scheduled_message_id uuid
    references public.conversation_scheduled_messages(id) on delete set null;
-- Sem CHECK: vocabulário aberto, vive em MOTIVOS_DE_LEMBRETE_PULADO
-- (lib/agenda/tipos.ts) e o emissor usa a constante.
alter table public.calendar_appointments
  add column if not exists reminder_skipped_reason text;

create index if not exists calendar_appointments_lembrete_pendente_idx
  on public.calendar_appointments (starts_at)
  where reminder_sent_at is null and status = 'confirmed' and contact_id is not null;

comment on column public.calendar_appointments.reminder_sent_at is
  'Carimbo de que o lembrete foi ENTREGUE À FILA de mensagens agendadas (conversation_scheduled_messages) — idempotência do lado do dado, para remarcação ou reprocesso não avisarem duas vezes. Quem envia é o cron scheduled-messages, com janela, espaçamento e opt-out.';
comment on column public.calendar_appointments.reminder_scheduled_message_id is
  'A mensagem agendada que leva o lembrete. Remarcar ou cancelar zera as três colunas de lembrete e cancela a mensagem que ainda não saiu.';
comment on column public.calendar_appointments.reminder_skipped_reason is
  'Por que o lembrete NÃO foi entregue à fila (vocabulário em MOTIVOS_DE_LEMBRETE_PULADO, lib/agenda/tipos.ts). NULL = não pulou.';

-- ────────────────────────────────────────────────────────────────────────────
-- 9 · RLS — configuração escreve manager+, operação escreve agent+
-- ────────────────────────────────────────────────────────────────────────────
alter table public.calendar_professionals enable row level security;
drop policy if exists tenant_isolation_calendar_professionals_all on public.calendar_professionals;
drop policy if exists calendar_professionals_select on public.calendar_professionals;
create policy calendar_professionals_select on public.calendar_professionals
  for select using (
    (organization_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin()
  );
drop policy if exists calendar_professionals_write on public.calendar_professionals;
create policy calendar_professionals_write on public.calendar_professionals
  using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );
revoke all on public.calendar_professionals from anon;

alter table public.calendar_event_type_professionals enable row level security;
drop policy if exists tenant_isolation_calendar_event_type_professionals_all on public.calendar_event_type_professionals;
drop policy if exists calendar_event_type_professionals_select on public.calendar_event_type_professionals;
create policy calendar_event_type_professionals_select on public.calendar_event_type_professionals
  for select using (
    (organization_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin()
  );
drop policy if exists calendar_event_type_professionals_write on public.calendar_event_type_professionals;
create policy calendar_event_type_professionals_write on public.calendar_event_type_professionals
  using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );
revoke all on public.calendar_event_type_professionals from anon;

alter table public.calendar_appointment_professionals enable row level security;
drop policy if exists tenant_isolation_calendar_appointment_professionals_all on public.calendar_appointment_professionals;
drop policy if exists calendar_appointment_professionals_select on public.calendar_appointment_professionals;
create policy calendar_appointment_professionals_select on public.calendar_appointment_professionals
  for select using (
    (organization_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin()
  );
drop policy if exists calendar_appointment_professionals_write on public.calendar_appointment_professionals;
create policy calendar_appointment_professionals_write on public.calendar_appointment_professionals
  using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent'))
  )
  with check (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent'))
  );
revoke all on public.calendar_appointment_professionals from anon;

drop trigger if exists trg_calendar_professionals_updated_at on public.calendar_professionals;
create trigger trg_calendar_professionals_updated_at
  before update on public.calendar_professionals
  for each row execute function public.fn_set_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- 10 · backfill — quem já está na agenda vira profissional (ordem importa)
-- ────────────────────────────────────────────────────────────────────────────
-- (a) um profissional para todo (organização, usuário) que já aparece na agenda.
-- O nome segue a mesma fonte de `fn_conversation_assign` (full_name do
-- user_metadata), cai para a parte local do e-mail e, em último caso, para
-- 'Profissional'. ⚠️ A MESMA expressão vive em fn_adotar_tipos_de_agendamento_sem_dono
-- (passo 11) — mude as duas juntas.
insert into public.calendar_professionals (organization_id, user_id, name, trilha, is_active)
select q.organization_id,
       q.user_id,
       left(btrim(coalesce(
         nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
         nullif(btrim(split_part(coalesce(u.email, ''), '@', 1)), ''),
         'Profissional')), 120),
       uo.calendar_trilha,
       (uo.id is not null and uo.revoked_at is null)
  from (
    select organization_id, default_owner_user_id as user_id
      from public.calendar_event_types where default_owner_user_id is not null
    union
    select organization_id, owner_user_id
      from public.calendar_appointments where owner_user_id is not null
    union
    select organization_id, user_id
      from public.calendar_availability_exceptions where user_id is not null
    union
    select organization_id, user_id
      from public.calendar_connections
    union
    select organization_id, user_id
      from public.attendant_availability
     where case when jsonb_typeof(schedule -> 'windows') = 'array'
                then jsonb_array_length(schedule -> 'windows') > 0
                else false end
  ) as q
  join auth.users u on u.id = q.user_id
  left join public.user_organizations uo
    on uo.organization_id = q.organization_id and uo.user_id = q.user_id
on conflict (organization_id, user_id) where user_id is not null do nothing;

-- (b) cada tipo habilita o seu dono padrão — SÓ em tipo que não tem habilitação
-- nenhuma. Re-aplicar não pode desfazer o conjunto que o operador escolheu.
insert into public.calendar_event_type_professionals (organization_id, event_type_id, professional_id)
select t.organization_id, t.id, p.id
  from public.calendar_event_types t
  join public.calendar_professionals p
    on p.organization_id = t.organization_id and p.user_id = t.default_owner_user_id
 where t.default_owner_user_id is not null
   and not exists (
     select 1 from public.calendar_event_type_professionals h
      where h.organization_id = t.organization_id and h.event_type_id = t.id
   )
on conflict do nothing;

-- (c) todo agendamento com dono ganha a principal. `on conflict do nothing`
-- sem alvo engole também `cap_sem_duplicata_idx`: um clone com duplicata
-- legada não quebra o update — a 0182 já deslocou as duplicatas por dono.
insert into public.calendar_appointment_professionals
  (organization_id, appointment_id, professional_id, role, starts_at, ends_at, status)
select a.organization_id, a.id, p.id, 'principal', a.starts_at, a.ends_at, a.status
  from public.calendar_appointments a
  join public.calendar_professionals p
    on p.organization_id = a.organization_id and p.user_id = a.owner_user_id
 where a.owner_user_id is not null
   and not exists (
     select 1 from public.calendar_appointment_professionals x
      where x.appointment_id = a.id and x.role = 'principal'
   )
on conflict do nothing;

-- (d) exceções apontam para o profissional do dono.
update public.calendar_availability_exceptions e
   set professional_id = p.id
  from public.calendar_professionals p
 where e.professional_id is null
   and e.user_id is not null
   and p.organization_id = e.organization_id
   and p.user_id = e.user_id;

-- Depois do backfill: (organização, usuário) ↔ profissional é 1:1, então a
-- unique antiga por user_id já garante que esta nasce sem duplicata.
create unique index if not exists calendar_exceptions_profissional_dia_faixa_key
  on public.calendar_availability_exceptions (organization_id, professional_id, exception_date, start_minute)
  where professional_id is not null;

-- ────────────────────────────────────────────────────────────────────────────
-- 11 · o primeiro membro também vira profissional (instalação fresca)
-- ────────────────────────────────────────────────────────────────────────────
-- A 0195 dá dono aos tipos semeados quando o primeiro membro ATIVO chega. Com
-- a agenda de profissionais, dono sem profissional e tipo sem habilitação
-- deixariam a instalação fresca sem horário de novo. Mesma condição da 0195
-- (só o primeiro ativo), e a habilitação só entra em tipo que não tem nenhuma.
create or replace function public.fn_adotar_tipos_de_agendamento_sem_dono()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  -- Só o primeiro membro ATIVO da organização.
  --
  -- ⚠️ As duas condições nasceram de um caso que a predição pegou antes do commit: sem
  -- `new.revoked_at is null`, uma linha que JÁ nasce revogada adota os tipos e o dono padrão
  -- da agenda vira alguém que nunca esteve lá. E contar TODOS em vez de só os ativos criaria
  -- o furo simétrico: numa org com um ex-membro, o primeiro membro de verdade veria contagem
  -- 2 e não adotaria nada — a org ficaria órfã para sempre.
  --
  -- `= 1` e não `> 0`: neste ponto a linha nova já está na tabela, então o primeiro ativo
  -- vê contagem 1.
  if new.revoked_at is null
     and (select count(*) from public.user_organizations u
           where u.organization_id = new.organization_id
             and u.revoked_at is null) = 1 then
    update public.calendar_event_types
       set default_owner_user_id = new.user_id
     where organization_id = new.organization_id
       and default_owner_user_id is null;

    -- (0245) O membro vira profissional — mesma expressão de nome do backfill.
    insert into public.calendar_professionals (organization_id, user_id, name, trilha)
    select new.organization_id,
           new.user_id,
           left(btrim(coalesce(
             nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
             nullif(btrim(split_part(coalesce(u.email, ''), '@', 1)), ''),
             'Profissional')), 120),
           new.calendar_trilha
      from auth.users u
     where u.id = new.user_id
    on conflict (organization_id, user_id) where user_id is not null do nothing;

    -- (0245) E faz todo tipo da organização que ainda não tem habilitação.
    insert into public.calendar_event_type_professionals (organization_id, event_type_id, professional_id)
    select t.organization_id, t.id, p.id
      from public.calendar_event_types t
      join public.calendar_professionals p
        on p.organization_id = t.organization_id and p.user_id = new.user_id
     where t.organization_id = new.organization_id
       and not exists (
         select 1 from public.calendar_event_type_professionals h
          where h.organization_id = t.organization_id and h.event_type_id = t.id
       )
    on conflict do nothing;
  end if;
  return new;
end
$fn$;

revoke execute on function public.fn_adotar_tipos_de_agendamento_sem_dono() from public, anon, authenticated;
grant  execute on function public.fn_adotar_tipos_de_agendamento_sem_dono() to service_role;

notify pgrst, 'reload schema';
