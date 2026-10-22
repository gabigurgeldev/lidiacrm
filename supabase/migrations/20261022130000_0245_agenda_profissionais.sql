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
-- O espelho NÃO é editável por quem usa o sistema: `authenticated` não tem
-- UPDATE nem DELETE nesta tabela, só INSERT (agent+, que é o que a
-- `fn_agenda_marcar` — security invoker — precisa). A função do espelho é
-- `security definer` justamente para mover a cópia SEM que o papel de quem
-- remarca precise de UPDATE. Com UPDATE para agent+, um agente pelo PostgREST
-- tirava a profissional da guarda de duplicata editando só a cópia.
--
-- ─── Sobreposição: travada no caminho de marcar e de remarcar ─────────────
-- O índice `cap_sem_duplicata_idx` só enxerga o MESMO instante. 10:00–11:00 e
-- 10:30–11:30 da mesma profissional passavam por ele, e duas marcações
-- simultâneas que a consulta aprovou podiam gravar as duas.
-- `fn_agenda_conferir_livre` fecha isso: trava cada profissional
-- (`pg_advisory_xact_lock`, em ordem FIXA — ids ordenados — para duas
-- transações nunca se travarem cruzado) e SÓ ENTÃO reconfere sobreposição
-- contra os participantes vivos e contra o legado por `owner_user_id` (linha
-- anterior à 0245 que não ganhou participante). Colidiu: 23505, que a rota já
-- traduz em 409. Quem chama: `fn_agenda_marcar` (antes do INSERT) e o espelho
-- (ao remarcar ou reabrir). O encaixe da 0182 continua valendo NA TABELA —
-- INSERT cru em `calendar_appointments` (sync, legado) segue livre, e
-- `tests/invariants/agenda-sem-duplicata.test.ts` continua sendo a régua —;
-- o que muda é que o caminho do produto não grava o que a consulta não ofereceria.
--
-- ─── `booked_at`: quando o horário foi FIXADO ─────────────────────────────
-- O lembrete precisa saber "quanto tempo antes da consulta a pessoa ficou
-- sabendo do horário". `created_at` responde errado depois de remarcar: a
-- consulta marcada há um mês e remarcada para daqui a 2 h parece antiga. Nasce
-- `now()`, e o trigger `trg_agenda_horario_fixado` a carimba de novo sempre que
-- `starts_at` muda. As linhas existentes recebem `created_at` — ver a seção 8.
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
-- agendamento é OPERAÇÃO — lê membro, INSERE agent+ (só INSERT: o espelho é
-- mantido pelo trigger, e nenhum código apaga participante — sai em cascata
-- com o agendamento).
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
-- `fn_agenda_marcar` e `fn_agenda_conferir_livre` são `security invoker` — a
-- RLS de quem chama vale dentro delas. As três de trigger
-- (`fn_agenda_participantes_acompanham`, `fn_agenda_horario_fixado` e a
-- `fn_adotar_tipos_de_agendamento_sem_dono` da 0195) não são executáveis por
-- ninguém de fora. Toda função revoga as duas origens de EXECUTE (public e
-- anon), como manda a doutrina de migrations.
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
-- 0182: coincidência exata de instante, e só nas situações que ocupam. É a
-- última palavra para QUALQUER escrita na tabela; a sobreposição parcial é
-- conferida, sob trava, por `fn_agenda_conferir_livre` (seção 4).
create unique index if not exists cap_sem_duplicata_idx
  on public.calendar_appointment_professionals (organization_id, professional_id, starts_at)
  where status in ('pending', 'confirmed');
create index if not exists cap_agenda_idx
  on public.calendar_appointment_professionals (organization_id, professional_id, starts_at);

comment on table public.calendar_appointment_professionals is
  'Quem atende cada agendamento: uma principal e, quando o tipo pede duas, uma apoio. starts_at/ends_at/status são ESPELHO de calendar_appointments (trigger trg_agenda_participantes_acompanham) e existem para o índice cap_sem_duplicata_idx impedir a mesma profissional em dois agendamentos vivos no mesmo instante.';

-- ────────────────────────────────────────────────────────────────────────────
-- 4 · ninguém ocupa duas vezes o mesmo pedaço de tempo — e o espelho acompanha
-- ────────────────────────────────────────────────────────────────────────────
-- (a) A reconferência sob trava. Ver "Sobreposição" no cabeçalho.
--
-- ⚠️ A TRAVA VEM ANTES DA LEITURA, e cada comando de uma função plpgsql volátil
-- tira snapshot novo: quem esperou a trava enxerga o que a outra transação
-- gravou e commitou. Ler antes de travar deixaria passar exatamente a corrida
-- que este bloco existe para fechar.
--
-- `p_ignorar` = o próprio agendamento, ao remarcar: ele ocupa o horário antigo
-- e não pode colidir consigo mesmo. NULL ao marcar.
--
-- security invoker: chamada pela `fn_agenda_marcar` com o papel da sessão (a
-- RLS de leitura dela basta — a busca é só na própria organização) e pelo
-- espelho, que é definer.
create or replace function public.fn_agenda_conferir_livre(
  p_organization_id uuid,
  p_profissionais uuid[],
  p_inicio timestamptz,
  p_fim timestamptz,
  p_ignorar uuid
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  v_profissional uuid;
  v_ocupada text;
begin
  for v_profissional in
    select distinct x from unnest(p_profissionais) as x where x is not null order by 1
  loop
    perform pg_advisory_xact_lock(
      hashtextextended(p_organization_id::text || ':' || v_profissional::text, 0));
  end loop;

  select p.name
    into v_ocupada
    from public.calendar_professionals p
   where p.organization_id = p_organization_id
     and p.id = any (p_profissionais)
     and (
       exists (
         select 1 from public.calendar_appointment_professionals c
          where c.organization_id = p_organization_id
            and c.professional_id = p.id
            and c.appointment_id is distinct from p_ignorar
            and c.status in ('pending', 'confirmed')
            and c.starts_at < p_fim
            and c.ends_at > p_inicio
       )
       -- O legado por dono: agendamento anterior à 0245 sem participante.
       or (p.user_id is not null and exists (
         select 1 from public.calendar_appointments a
          where a.organization_id = p_organization_id
            and a.owner_user_id = p.user_id
            and a.id is distinct from p_ignorar
            and a.status in ('pending', 'confirmed')
            and a.starts_at < p_fim
            and a.ends_at > p_inicio
       ))
     )
   order by p.name
   limit 1;

  if found then
    raise exception 'agenda: horário ocupado — % já atende neste intervalo', v_ocupada
      using errcode = '23505', hint = 'agenda:horario_ocupado';
  end if;
end
$fn$;

revoke execute on function public.fn_agenda_conferir_livre(uuid, uuid[], timestamptz, timestamptz, uuid) from public, anon;
grant  execute on function public.fn_agenda_conferir_livre(uuid, uuid[], timestamptz, timestamptz, uuid) to authenticated, service_role;

comment on function public.fn_agenda_conferir_livre(uuid, uuid[], timestamptz, timestamptz, uuid) is
  'Trava (pg_advisory_xact_lock, ids ordenados) cada profissional e reconfere sobreposição contra participantes vivos e contra o legado por owner_user_id. Colidiu: 23505, hint agenda:horario_ocupado. Chamada por fn_agenda_marcar e pelo espelho ao remarcar.';

-- (b) O espelho. `security definer` porque `authenticated` não tem UPDATE na
-- tabela de participantes (seção 9): quem remarca move a cópia por aqui, e só
-- por aqui. O filtro é o par (organização, agendamento) da própria linha.
create or replace function public.fn_agenda_participantes_acompanham()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_profissionais uuid[];
begin
  -- Remarcar (ou reabrir) para um horário que OCUPA: reconfere sob trava as
  -- participantes e o profissional do dono legado. Só quando o pedaço de tempo
  -- ocupado muda — confirmar um pendente no mesmo horário não reconfere, para
  -- um encaixe legado não virar 23505 ao ser confirmado.
  if new.status in ('pending', 'confirmed')
     and (old.starts_at is distinct from new.starts_at
          or old.ends_at is distinct from new.ends_at
          or old.status not in ('pending', 'confirmed')) then
    select coalesce(array_agg(distinct s.id), '{}'::uuid[])
      into v_profissionais
      from (
        select c.professional_id as id
          from public.calendar_appointment_professionals c
         where c.organization_id = new.organization_id
           and c.appointment_id = new.id
        union
        select p.id
          from public.calendar_professionals p
         where p.organization_id = new.organization_id
           and p.user_id = new.owner_user_id
      ) as s;
    perform public.fn_agenda_conferir_livre(
      new.organization_id, v_profissionais, new.starts_at, new.ends_at, new.id);
  end if;

  -- E o instante EXATO continua com a última palavra: remarcar em cima da
  -- principal OU da apoio vira 23505 (cap_sem_duplicata_idx) aqui dentro, e o
  -- UPDATE inteiro desfaz.
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
-- agendamento gravado. Aqui é uma transação: qualquer recusa desfaz tudo.
--
-- ⚠️ ESTA FUNÇÃO É PORTA, NÃO SÓ ATALHO. `authenticated` tem EXECUTE nela, então
-- qualquer sessão agent+ a chama direto pelo PostgREST, sem passar pela rota.
-- Por isso ela mesma confere o que a rota confere — com `organization_id =
-- p_organization_id` em toda busca —, e não confia em nada que a rota decide:
--
--   · o TIPO existe nesta organização e está ativo, e pede exatamente
--     `cardinality(p_profissionais)` profissionais;
--   · o CONTATO e a CONVERSA (se informados) são desta organização, e a
--     conversa é DAQUELE contato — senão o lembrete sai para outra pessoa. A FK
--     simples `contact_id → contacts(id)` não olha organização (e FK ignora
--     RLS): sem esta conferência, a org A gravava o cliente da B;
--   · cada PROFISSIONAL é desta organização, está ativa, é membro ativo quando
--     tem login, e está habilitada no tipo quando o tipo tem habilitação;
--   · `owner_user_id` NÃO é escolhido por quem chama: é o login da principal
--     (NULL quando ela não tem). Se vier no jsonb, tem de bater;
--   · `status` NÃO é escolhido por quem chama: `pending` se o tipo pede
--     confirmação, `confirmed` se não;
--   · a AUTORIA com sessão é a sessão: `created_by_user_id = auth.uid()`,
--     `created_by_kind = 'user'`, `source = 'ui'`. Só sem sessão (service_role:
--     a ferramenta MCP) ela vem do jsonb — e o agente tem de ser desta
--     organização, o usuário membro ativo dela, e o `created_by_kind` coerente.
--
-- As colunas do agendamento vêm de uma LISTA FECHADA (`v_permitidas`): chave
-- fora dela é ignorada; as ausentes ficam com o DEFAULT da tabela (inclusive
-- `booked_at = now()`). `organization_id` vem SEMPRE do parâmetro; google_*,
-- reminder_*, booked_at, rescheduled_from_id e id não são graváveis por aqui.
--
-- O CONTRATO DE ERRO — o SQLSTATE separa a classe, o HINT nomeia o motivo, e é
-- pelo hint que a rota escolhe o código de API:
--   22023  hint agenda:argumento             forma do pedido (jsonb, horário ausente)
--   22023  hint agenda:profissional_invalido 0, 3+, repetida ou nula em p_profissionais
--   P0001  hint agenda:tipo_inexistente      tipo ausente ou de outra organização
--   P0001  hint agenda:tipo_desativado       tipo desativado
--   P0001  hint agenda:profissionais_insuficientes  quantidade ≠ professionals_required
--   P0001  hint agenda:contato_inexistente   contato de outra organização / inexistente
--   P0001  hint agenda:conversa_inexistente  conversa de outra organização / inexistente
--   P0001  hint agenda:conversa_de_outro_contato  a conversa é de outro contato
--   P0001  hint agenda:profissional_invalido profissional alheia, inativa, ex-membro,
--                                            não habilitada, ou owner_user_id divergente
--   P0001  hint agenda:agente_inexistente    created_by_agent_id de outra organização
--   P0001  hint agenda:autor_invalido        autoria incoerente (sem sessão)
--   23505  hint agenda:horario_ocupado       sobreposição (fn_agenda_conferir_livre)
--   23505  (sem hint)                        instante exato — índices únicos
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
    'owner_user_id', 'contact_id', 'conversation_id', 'location_kind',
    'location_details', 'meeting_url', 'notes',
    'created_by_kind', 'created_by_user_id', 'created_by_agent_id', 'source'
  ];
  v_sessao uuid := auth.uid();
  v_dados jsonb;
  v_pedido public.calendar_appointments;
  v_tipo record;
  v_contato_da_conversa uuid;
  v_validas integer;
  v_dono uuid;
  v_colunas text;
  v_id uuid;
begin
  if p_profissionais is null
     or cardinality(p_profissionais) < 1
     or cardinality(p_profissionais) > 2 then
    raise exception 'fn_agenda_marcar: um agendamento tem 1 ou 2 profissionais (recebeu %)',
      coalesce(cardinality(p_profissionais), 0)
      using errcode = '22023', hint = 'agenda:profissional_invalido';
  end if;
  -- Repetida ou nula cairia na PK como 23505, que a rota lê como "horário
  -- ocupado" — mentira. Recusa aqui, com o código de argumento inválido.
  if array_position(p_profissionais, null) is not null
     or (select count(distinct x) from unnest(p_profissionais) as x) <> cardinality(p_profissionais) then
    raise exception 'fn_agenda_marcar: profissional repetida ou nula em %', p_profissionais
      using errcode = '22023', hint = 'agenda:profissional_invalido';
  end if;
  if p_compromisso is null or jsonb_typeof(p_compromisso) <> 'object' then
    raise exception 'fn_agenda_marcar: p_compromisso precisa ser um objeto jsonb'
      using errcode = '22023', hint = 'agenda:argumento';
  end if;

  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    into v_dados
    from jsonb_each(p_compromisso) as e
   where e.key = any (v_permitidas);
  v_pedido := jsonb_populate_record(null::public.calendar_appointments, v_dados);

  if v_pedido.starts_at is null or v_pedido.ends_at is null then
    raise exception 'fn_agenda_marcar: starts_at e ends_at são obrigatórios'
      using errcode = '22023', hint = 'agenda:argumento';
  end if;

  -- O tipo.
  select t.id, t.name, t.is_active, t.requires_confirmation, t.professionals_required
    into v_tipo
    from public.calendar_event_types t
   where t.organization_id = p_organization_id
     and t.id = v_pedido.event_type_id;
  if not found then
    raise exception 'fn_agenda_marcar: tipo de agendamento % não existe nesta organização',
      v_pedido.event_type_id
      using errcode = 'P0001', hint = 'agenda:tipo_inexistente';
  end if;
  if not v_tipo.is_active then
    raise exception 'fn_agenda_marcar: "%" está desativado', v_tipo.name
      using errcode = 'P0001', hint = 'agenda:tipo_desativado';
  end if;
  if cardinality(p_profissionais) <> v_tipo.professionals_required then
    raise exception 'fn_agenda_marcar: "%" pede % profissional(is), e vieram %',
      v_tipo.name, v_tipo.professionals_required, cardinality(p_profissionais)
      using errcode = 'P0001', hint = 'agenda:profissionais_insuficientes';
  end if;

  -- O contato.
  if v_pedido.contact_id is not null and not exists (
    select 1 from public.contacts c
     where c.organization_id = p_organization_id and c.id = v_pedido.contact_id
  ) then
    raise exception 'fn_agenda_marcar: contato % não existe nesta organização', v_pedido.contact_id
      using errcode = 'P0001', hint = 'agenda:contato_inexistente';
  end if;

  -- A conversa: desta organização E daquele contato. Sem contato no pedido, é
  -- ela que define quem é atendido.
  if v_pedido.conversation_id is not null then
    select cv.contact_id
      into v_contato_da_conversa
      from public.conversations cv
     where cv.organization_id = p_organization_id and cv.id = v_pedido.conversation_id;
    if not found then
      raise exception 'fn_agenda_marcar: conversa % não existe nesta organização', v_pedido.conversation_id
        using errcode = 'P0001', hint = 'agenda:conversa_inexistente';
    end if;
    if v_pedido.contact_id is null then
      v_dados := v_dados || jsonb_build_object('contact_id', v_contato_da_conversa);
    elsif v_contato_da_conversa is distinct from v_pedido.contact_id then
      raise exception 'fn_agenda_marcar: a conversa % é de outro contato', v_pedido.conversation_id
        using errcode = 'P0001', hint = 'agenda:conversa_de_outro_contato';
    end if;
  end if;

  -- As profissionais. "Membro ativo" por duas portas: `fn_member_role_in_org`
  -- responde a quem é membro da org (o agent, que pela RLS só lê a própria
  -- linha de `user_organizations`), e a leitura direta cobre o platform admin.
  select count(*)
    into v_validas
    from public.calendar_professionals p
   where p.organization_id = p_organization_id
     and p.id = any (p_profissionais)
     and p.is_active
     and (
       p.user_id is null
       or public.fn_member_role_in_org(p.user_id, p_organization_id) is not null
       or exists (
         select 1 from public.user_organizations uo
          where uo.organization_id = p_organization_id
            and uo.user_id = p.user_id
            and uo.revoked_at is null
       )
     )
     and (
       not exists (
         select 1 from public.calendar_event_type_professionals h
          where h.organization_id = p_organization_id and h.event_type_id = v_tipo.id
       )
       or exists (
         select 1 from public.calendar_event_type_professionals h
          where h.organization_id = p_organization_id
            and h.event_type_id = v_tipo.id
            and h.professional_id = p.id
       )
     );
  if v_validas <> cardinality(p_profissionais) then
    raise exception 'fn_agenda_marcar: profissional inexistente, desativada, fora da equipe ou não habilitada em "%"',
      v_tipo.name
      using errcode = 'P0001', hint = 'agenda:profissional_invalido';
  end if;

  -- O dono é o login da principal.
  select p.user_id
    into v_dono
    from public.calendar_professionals p
   where p.organization_id = p_organization_id and p.id = p_profissionais[1];
  if v_dados ? 'owner_user_id' and v_pedido.owner_user_id is distinct from v_dono then
    raise exception 'fn_agenda_marcar: owner_user_id não é o login da principal'
      using errcode = 'P0001', hint = 'agenda:profissional_invalido';
  end if;

  -- A autoria.
  if v_sessao is not null then
    v_dados := v_dados || jsonb_build_object(
      'created_by_kind', 'user',
      'created_by_user_id', v_sessao,
      'created_by_agent_id', null,
      'source', 'ui');
  else
    if v_pedido.created_by_agent_id is not null then
      if not exists (
        select 1 from public.ai_agents ag
         where ag.organization_id = p_organization_id and ag.id = v_pedido.created_by_agent_id
      ) then
        raise exception 'fn_agenda_marcar: agente % não é desta organização', v_pedido.created_by_agent_id
          using errcode = 'P0001', hint = 'agenda:agente_inexistente';
      end if;
      if v_pedido.created_by_kind is distinct from 'ai' then
        raise exception 'fn_agenda_marcar: created_by_agent_id exige created_by_kind = ai'
          using errcode = 'P0001', hint = 'agenda:autor_invalido';
      end if;
    end if;
    if v_pedido.created_by_user_id is not null then
      if public.fn_member_role_in_org(v_pedido.created_by_user_id, p_organization_id) is null then
        raise exception 'fn_agenda_marcar: created_by_user_id não é membro ativo desta organização'
          using errcode = 'P0001', hint = 'agenda:autor_invalido';
      end if;
      if coalesce(v_pedido.created_by_kind, 'user') <> 'user' then
        raise exception 'fn_agenda_marcar: created_by_user_id exige created_by_kind = user'
          using errcode = 'P0001', hint = 'agenda:autor_invalido';
      end if;
    end if;
  end if;

  -- O que o servidor decide.
  v_dados := v_dados || jsonb_build_object(
    'status', case when v_tipo.requires_confirmation then 'pending' else 'confirmed' end,
    'owner_user_id', v_dono);

  -- Trava as profissionais e reconfere sobreposição ANTES de gravar.
  perform public.fn_agenda_conferir_livre(
    p_organization_id, p_profissionais, v_pedido.starts_at, v_pedido.ends_at, null);

  select string_agg(format('%I', k), ', ' order by k)
    into v_colunas
    from jsonb_object_keys(v_dados) as k;

  execute format(
    'insert into public.calendar_appointments (organization_id, %1$s)
     select $1, %1$s from jsonb_populate_record(null::public.calendar_appointments, $2)
     returning id',
    v_colunas)
    into v_id
    using p_organization_id, v_dados;

  -- 1ª da lista = principal; a 2ª, se houver, apoio.
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
  'Marca um agendamento e grava quem atende, atomicamente. p_profissionais: 1 ou 2, a primeira é a principal. security invoker: a RLS de quem chama vale aqui dentro, e a função confere sozinha tipo, contato, conversa, profissionais e autoria contra p_organization_id. status e owner_user_id são decididos aqui; com sessão, a autoria é auth.uid(). Erros: 22023 = argumento; P0001 + hint agenda:<motivo> = recusa nomeada; 23505 = horário ocupado. O contrato completo está no comentário da migration 0245.';

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

-- `booked_at` — quando o horário ATUAL foi fixado. Ver o cabeçalho.
--
-- A ordem é a da auto-cura: coluna nula, DEFAULT, backfill, NOT NULL. Re-aplicar
-- não acha linha nula e não faz nada; um clone em que o backfill falhou acha, e
-- termina o serviço no `update.sh` seguinte. O DEFAULT entra ANTES do backfill
-- para uma marcação que chegue no meio do `update.sh` não nascer nula.
--
-- ⚠️ O BACKFILL DESLIGA `trg_calendar_appointments_updated_at` — só ele, e só
-- dentro do `do $$`. Sem isso o UPDATE carimbaria `updated_at = now()` em TODO
-- agendamento do histórico, e `needs_google_push` (= updated_at >
-- google_synced_at) mandaria a agenda inteira de volta ao Google no próximo
-- cron. A objeção da 0140 a `disable trigger` ("um update.sh que morra entre o
-- disable e o enable deixa a instalação sem o trigger") não se aplica: o `do $$`
-- é UM comando, e o desligar, o UPDATE e o religar são desfeitos juntos se
-- qualquer um falhar. O `alter table` segura a trava da tabela até o fim do
-- comando, então nenhuma escrita concorrente passa com o trigger desligado.
alter table public.calendar_appointments
  add column if not exists booked_at timestamptz;
alter table public.calendar_appointments
  alter column booked_at set default now();

do $backfill$
declare
  v_tem_trigger boolean;
begin
  if not exists (select 1 from public.calendar_appointments where booked_at is null) then
    return;
  end if;
  select exists (
    select 1 from pg_trigger
     where tgrelid = 'public.calendar_appointments'::regclass
       and tgname = 'trg_calendar_appointments_updated_at'
       and not tgisinternal
  ) into v_tem_trigger;

  if v_tem_trigger then
    alter table public.calendar_appointments disable trigger trg_calendar_appointments_updated_at;
  end if;
  update public.calendar_appointments
     set booked_at = created_at
   where booked_at is null;
  if v_tem_trigger then
    alter table public.calendar_appointments enable trigger trg_calendar_appointments_updated_at;
  end if;
end
$backfill$;

alter table public.calendar_appointments
  alter column booked_at set not null;

comment on column public.calendar_appointments.booked_at is
  'Quando o horário ATUAL foi fixado: now() ao marcar, de novo a cada mudança de starts_at (trigger trg_agenda_horario_fixado). Linhas anteriores à 0245 = created_at. É o que o lembrete compara com starts_at — created_at mente depois de remarcar.';

create or replace function public.fn_agenda_horario_fixado()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
begin
  new.booked_at := now();
  return new;
end
$fn$;

revoke execute on function public.fn_agenda_horario_fixado() from public, anon, authenticated;
grant  execute on function public.fn_agenda_horario_fixado() to service_role;

drop trigger if exists trg_agenda_horario_fixado on public.calendar_appointments;
create trigger trg_agenda_horario_fixado
  before update of starts_at on public.calendar_appointments
  for each row
  when (old.starts_at is distinct from new.starts_at)
  execute function public.fn_agenda_horario_fixado();

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
-- SÓ INSERT para agent+ (é o que a `fn_agenda_marcar`, invoker, precisa). Sem
-- UPDATE: a cópia de horário/situação é do trigger do espelho (definer) — com
-- UPDATE, um agente pelo PostgREST movia a cópia e tirava a profissional da
-- guarda de duplicata sem mexer no agendamento. Sem DELETE: nenhum código apaga
-- participante; ele sai em cascata com o agendamento (a ação de FK roda como
-- dona da tabela, não como a sessão). O `revoke` fecha também o caminho de quem
-- ganhasse uma policy permissiva por engano depois.
drop policy if exists calendar_appointment_professionals_write on public.calendar_appointment_professionals;
drop policy if exists calendar_appointment_professionals_insert on public.calendar_appointment_professionals;
create policy calendar_appointment_professionals_insert on public.calendar_appointment_professionals
  for insert with check (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent'))
  );
revoke all on public.calendar_appointment_professionals from anon;
revoke update, delete on public.calendar_appointment_professionals from authenticated;

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

-- (a2) quem SAIU da equipe não atende. O `insert` acima já nasce inativo para ex-
-- membro, mas `on conflict do nothing` não toca na linha que JÁ existia — e a
-- desativação no momento da revogação (lib/agenda/profissionais.ts) é
-- best-effort. Este passo cura as duas sobras a cada `update.sh`. Só desliga,
-- nunca religa: reativar é decisão de operador. Idempotente: a segunda rodada
-- não acha linha ativa de ex-membro. A `fn_agenda_marcar` recusa ex-membro de
-- qualquer jeito; isto é o que tira a pessoa da OFERTA de horário.
update public.calendar_professionals p
   set is_active = false
 where p.is_active
   and p.user_id is not null
   and exists (
     select 1 from public.user_organizations uo
      where uo.organization_id = p.organization_id
        and uo.user_id = p.user_id
        and uo.revoked_at is not null
   )
   and not exists (
     select 1 from public.user_organizations uo
      where uo.organization_id = p.organization_id
        and uo.user_id = p.user_id
        and uo.revoked_at is null
   );

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
