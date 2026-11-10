-- 0253 · RLS de escopo (conversas, leads, mensagens) sem função por linha.
--
-- O DEFEITO, medido em produção. `conversations_select` era
-- `fn_can_view_conversation(organization_id, assigned_to_user_id)`, e
-- `crm_leads_select` o gêmeo `fn_can_view_lead`. Cada chamada é uma
-- `security definer` com `set search_path` (não é embutida pelo planejador) que
-- chama mais três definers — `fn_is_platform_admin` e `fn_user_role_in_org` duas
-- vezes —, cada uma com a sua consulta. Isso roda UMA VEZ POR LINHA candidata,
-- antes do ORDER BY/LIMIT. Numa organização com 475 conversas, contar as
-- conversas como admin levou de 274 ms a 11,8 s (a VPS de 2 vCPU com o banco a
-- 100%); a mesma regra escrita como abaixo levou 5 ms.
--
-- E não é uma consulta: cada mensagem recebida dispara, em cada aba aberta do
-- inbox, a releitura da lista, das contagens das abas e do hilo — e
-- `messages_select` herda a policy de `conversations` por `exists`, então o
-- hilo de 50 mensagens pagava 50 avaliações. O banco saturava, a fila de
-- leituras crescia, e a mensagem que já estava no banco em 1 s levava muito
-- mais para aparecer na tela — a pessoa voltava a atender pelo celular.
--
-- A CORREÇÃO. O que depende só de QUEM consulta (é platform admin? em que
-- organizações vê tudo? em quais vê também o que não tem dono?) sai para
-- funções sem argumento de linha, chamadas como `(select f())` — o Postgres as
-- avalia uma vez por consulta (InitPlan). Por linha sobra comparação de uuid
-- com array. A regra é a MESMA de `fn_can_view_conversation`, ramo a ramo:
--
--   platform admin                                  → vê tudo
--   sem papel na organização                         → não vê
--   viewer / manager / admin                         → vê tudo da organização
--   conversa/lead atribuído a mim                    → vê
--   outro papel, visibility_mode 'all'               → vê tudo
--   outro papel, 'own_and_unassigned' (o padrão)     → vê o que não tem dono
--   outro papel, qualquer outro modo                 → não vê
--
-- `fn_can_view_conversation` e `fn_can_view_lead` ficam como estão: as policies
-- de ESCRITA de leads seguem chamando a segunda (escrita é uma linha por vez),
-- e quem lê a regra por elas continua lendo a regra certa.
--
-- Idempotente: `create or replace` e `drop policy if exists` + `create policy`.
-- As policies nascem `to authenticated` (regra da 0252: tabela publicada no
-- Realtime não tem policy que valha para anon).

-- Organizações em que quem consulta vê TODAS as conversas e leads.
create or replace function public.fn_orgs_com_visao_total()
returns uuid[]
language sql stable security definer
set search_path = public
as $$
  select coalesce(array_agg(uo.organization_id), '{}'::uuid[])
    from public.user_organizations uo
    join public.organizations o on o.id = uo.organization_id
   where uo.user_id = auth.uid()
     and uo.revoked_at is null
     and (
       uo.role in ('viewer', 'manager', 'admin')
       or coalesce(o.settings->>'visibility_mode', 'own_and_unassigned') = 'all'
     );
$$;

-- Organizações em que quem consulta vê, além do que é seu, o que não tem dono.
create or replace function public.fn_orgs_com_visao_sem_dono()
returns uuid[]
language sql stable security definer
set search_path = public
as $$
  select coalesce(array_agg(uo.organization_id), '{}'::uuid[])
    from public.user_organizations uo
    join public.organizations o on o.id = uo.organization_id
   where uo.user_id = auth.uid()
     and uo.revoked_at is null
     and uo.role not in ('viewer', 'manager', 'admin')
     and coalesce(o.settings->>'visibility_mode', 'own_and_unassigned') = 'own_and_unassigned';
$$;

revoke execute on function public.fn_orgs_com_visao_total() from public, anon;
revoke execute on function public.fn_orgs_com_visao_sem_dono() from public, anon;
grant execute on function public.fn_orgs_com_visao_total() to authenticated, service_role;
grant execute on function public.fn_orgs_com_visao_sem_dono() to authenticated, service_role;

drop policy if exists "conversations_select" on public.conversations;
create policy "conversations_select" on public.conversations
  for select to authenticated using (
    (select public.fn_is_platform_admin())
    or organization_id = any ((select public.fn_orgs_com_visao_total())::uuid[])
    or (assigned_to_user_id = (select auth.uid())
        and organization_id in (select public.fn_user_org_ids()))
    or (assigned_to_user_id is null
        and organization_id = any ((select public.fn_orgs_com_visao_sem_dono())::uuid[]))
  );

drop policy if exists "crm_leads_select" on public.crm_leads;
create policy "crm_leads_select" on public.crm_leads
  for select to authenticated using (
    (select public.fn_is_platform_admin())
    or organization_id = any ((select public.fn_orgs_com_visao_total())::uuid[])
    or (owner_user_id = (select auth.uid())
        and organization_id in (select public.fn_user_org_ids()))
    or (owner_user_id is null
        and organization_id = any ((select public.fn_orgs_com_visao_sem_dono())::uuid[]))
  );

-- O hilo herda o escopo da conversa. Só o platform admin sai da linha: era
-- avaliado por mensagem.
drop policy if exists "messages_select" on public.messages;
create policy "messages_select" on public.messages
  for select to authenticated using (
    (select public.fn_is_platform_admin())
    or exists (
      select 1 from public.conversations c
       where c.id = messages.conversation_id
    )
  );
