-- 0205 — Flow Engine: a policy nasceu ALL-só-tenancy, e a 0150 proíbe tabela
-- nova crescer essa dívida.
--
-- A 0203 criou `flows`/`flow_versions`/`flow_executions`/`flow_execution_events`
-- com `tenant_isolation_<tabela>_all` — isolamento por organização, mas SEM
-- `fn_role_at_least`: qualquer papel do tenant (inclusive `viewer`) conseguia
-- criar, editar e apagar fluxo falando direto com o PostgREST, com o próprio
-- JWT. `tests/invariants/rbac-config-ia-canais.test.ts` ("nenhuma tabela NOVA
-- entra com policy ALL só-tenancy") pegou isto no primeiro CI que rodou as
-- duas migrations (0203+0204) juntas contra um Postgres real — nenhum
-- ambiente anterior tinha essa prova.
--
-- Forward-fix, não edição da 0203: a doutrina de migrations proíbe editar
-- migration já mergeada. A 0203 nunca chegou a ser aplicada em nenhum banco
-- real (medido: sem SUPABASE_DB_URL de produção configurado em lugar nenhum
-- deste checkout, e este é o primeiro CI a exercitar as duas migrations
-- juntas) — mas "nunca aplicada ainda" não é a mesma garantia que "nunca vai
-- ser", e a doutrina não abre exceção pra isso.
--
-- Toda rota de `/api/v1/flows/**` (fora de `/ai/`) já exige `requireRole
-- ("manager", ...)` pra QUALQUER verbo, inclusive GET — diferente do padrão
-- select-aberto de `channel_sessions`/`ai_agents` (onde `viewer` lê a tela).
-- Aqui uma policy `for all` única, gated em 'manager', basta: não existe
-- leitura de flow que precise ficar aberta pra papel menor.
--
-- Aditiva e idempotente: drop + create da mesma policy, nenhuma linha muda.

drop policy if exists tenant_isolation_flows_all on public.flows;
create policy tenant_isolation_flows_all on public.flows
  for all using (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'manager'))
    or public.fn_is_platform_admin()
  ) with check (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'manager'))
    or public.fn_is_platform_admin()
  );

drop policy if exists tenant_isolation_flow_versions_all on public.flow_versions;
create policy tenant_isolation_flow_versions_all on public.flow_versions
  for all using (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'manager'))
    or public.fn_is_platform_admin()
  ) with check (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'manager'))
    or public.fn_is_platform_admin()
  );

drop policy if exists tenant_isolation_flow_executions_all on public.flow_executions;
create policy tenant_isolation_flow_executions_all on public.flow_executions
  for all using (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'manager'))
    or public.fn_is_platform_admin()
  ) with check (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'manager'))
    or public.fn_is_platform_admin()
  );

drop policy if exists tenant_isolation_flow_execution_events_all on public.flow_execution_events;
create policy tenant_isolation_flow_execution_events_all on public.flow_execution_events
  for all using (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'manager'))
    or public.fn_is_platform_admin()
  ) with check (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'manager'))
    or public.fn_is_platform_admin()
  );

notify pgrst, 'reload schema';
