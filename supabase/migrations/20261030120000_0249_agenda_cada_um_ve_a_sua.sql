-- 0249 · Agenda: cada atendente vê a sua.
--
-- Até aqui qualquer membro da organização lia TODOS os agendamentos — o
-- "filtro por pessoa" da tela era só visual (0177:71-73 dizia "o requisito é
-- filtro, não sigilo"). O requisito mudou: atendente (agent) e viewer veem só a
-- própria agenda; gerente, admin e platform admin veem a organização inteira.
--
-- "A própria agenda" = o agendamento em que a pessoa é DONA (login da
-- profissional principal), PARTICIPA (profissional de apoio com login) ou que
-- ELA CRIOU. O criador entra por duas razões:
--   1. `fn_agenda_marcar` é security invoker e faz `INSERT ... RETURNING` e,
--      logo depois, um SELECT na linha recém-criada para gravar os
--      participantes. Se quem marcou para um colega não visse a linha, a
--      marcação morreria em violação de RLS.
--   2. Quem marca pelo inbox para um colega precisa ver, no painel do contato,
--      o que acabou de marcar. Ele só vê o que ELE criou — não abre a agenda do
--      colega.
--
-- A ocupação continua visível a toda a organização, SEM detalhe:
-- `calendar_appointment_professionals` só tem intervalos e ids, e é por ela que
-- a tela de horários livres sabe que o colega está ocupado. A coleta de
-- horários livres no app passa a usar o client admin (org vinda do cookie) para
-- ler o legado por dono e a conexão Google do colega — ver
-- `app/api/v1/agenda/horarios-livres/route.ts`.
--
-- Armadilha (0035:14-19): uma policy `FOR ALL` de escrita também libera SELECT.
-- Por isso a escrita sai separada por comando.
--
-- Idempotente: `create or replace` + `drop policy if exists`.

-- ─── (a) quem vê um agendamento ──────────────────────────────────────────────
-- security definer: lê `calendar_appointment_professionals` sem depender da RLS
-- dela (e sem recursão de policy). Só responde sobre a sessão (`auth.uid()`).
create or replace function public.fn_can_view_appointment(
  p_org uuid,
  p_appointment_id uuid,
  p_owner_user_id uuid,
  p_created_by_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select public.fn_is_platform_admin()
      or (
        p_org in (select public.fn_user_org_ids())
        and (
          public.fn_role_at_least(p_org, 'manager')
          or p_owner_user_id = auth.uid()
          or p_created_by_user_id = auth.uid()
          or exists (
            select 1
              from public.calendar_appointment_professionals c
              join public.calendar_professionals p
                on p.organization_id = c.organization_id and p.id = c.professional_id
             where c.organization_id = p_org
               and c.appointment_id = p_appointment_id
               and p.user_id = auth.uid()
          )
        )
      );
$fn$;

revoke execute on function public.fn_can_view_appointment(uuid, uuid, uuid, uuid) from public, anon;
grant  execute on function public.fn_can_view_appointment(uuid, uuid, uuid, uuid) to authenticated, service_role;

comment on function public.fn_can_view_appointment(uuid, uuid, uuid, uuid) is
  'Agenda (0249): a sessão vê o agendamento se for manager+ ou platform admin, dona, participante ou quem o criou.';

-- ─── (b) calendar_appointments: uma policy por comando ───────────────────────
drop policy if exists calendar_appointments_write on public.calendar_appointments;

drop policy if exists calendar_appointments_select on public.calendar_appointments;
create policy calendar_appointments_select on public.calendar_appointments
  for select using (
    public.fn_can_view_appointment(organization_id, id, owner_user_id, created_by_user_id)
  );

-- Agent marca para qualquer colega (a validação de profissional é da
-- `fn_agenda_marcar`), mas a autoria tem de ser ele mesmo. Gerente+ grava como
-- quiser (importação, correção).
drop policy if exists calendar_appointments_insert on public.calendar_appointments;
create policy calendar_appointments_insert on public.calendar_appointments
  for insert with check (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent')
        and (public.fn_role_at_least(organization_id, 'manager')
             or created_by_user_id = auth.uid()))
  );

-- Quem vê e é agent+ opera (remarcar, confirmar, cancelar).
drop policy if exists calendar_appointments_update on public.calendar_appointments;
create policy calendar_appointments_update on public.calendar_appointments
  for update
  using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent')
        and public.fn_can_view_appointment(organization_id, id, owner_user_id, created_by_user_id))
  )
  with check (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent')
        and public.fn_can_view_appointment(organization_id, id, owner_user_id, created_by_user_id))
  );

-- Ninguém apaga agendamento pelo produto (cancelar é situação). Fica com a
-- gerência, que antes dividia isso com o agent pelo FOR ALL.
drop policy if exists calendar_appointments_delete on public.calendar_appointments;
create policy calendar_appointments_delete on public.calendar_appointments
  for delete using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

revoke all on public.calendar_appointments from anon;

-- ─── (c) o espelho do Google: o título é da pessoa, não da organização ───────
-- Antes, qualquer membro lia o TÍTULO dos eventos pessoais dos colegas direto
-- pelo PostgREST. Agora: dono da conexão ou gerente+, como em
-- `calendar_connection_calendars_select`.
drop policy if exists calendar_external_events_select on public.calendar_external_events;
create policy calendar_external_events_select on public.calendar_external_events
  for select using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and exists (
          select 1 from public.calendar_connections c
           where c.id = connection_id
             and (c.user_id = auth.uid()
                  or public.fn_role_at_least(c.organization_id, 'manager'))
        ))
  );
revoke all on public.calendar_external_events from anon;

-- ─── (d) a reconferência sob trava enxerga o legado do colega ────────────────
-- Era security invoker. Com a leitura de `calendar_appointments` recortada, um
-- agent que marca para um colega deixaria de ver o agendamento legado (sem
-- participante) dele e a sobreposição passaria. Vira definer, com guarda de
-- organização no corpo: só a sessão que é da organização (ou platform admin, ou
-- service role — `auth.uid()` nulo) chega à leitura. A função não devolve
-- linha nenhuma: só lança ou não lança.
create or replace function public.fn_agenda_conferir_livre(
  p_organization_id uuid,
  p_profissionais uuid[],
  p_inicio timestamptz,
  p_fim timestamptz,
  p_ignorar uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_profissional uuid;
  v_ocupada text;
begin
  if auth.uid() is not null
     and not (public.fn_is_platform_admin()
              or p_organization_id in (select public.fn_user_org_ids())) then
    raise exception 'agenda: organização fora do seu acesso'
      using errcode = '42501';
  end if;

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
  'Agenda (0245, definer desde 0249): trava as profissionais e lança 23505 se alguma já atende no intervalo. Não devolve linha.';

notify pgrst, 'reload schema';
