-- 0235 — LINK DE PAREAMENTO E VÍNCULO DO BACK OFFICE RESPEITAM O PAPEL.
--
-- As duas tabelas nasceram (0213 e 0216) com policy `ALL` só de tenancy:
-- `organization_id in (select fn_user_org_ids())`. A RLS isolava a organização
-- e não olhava o PAPEL — a mesma dívida que a 0150 pagou nas tabelas de
-- configuração. O PostgREST é exposto ao navegador por construção (URL + anon
-- key vão no bundle), e qualquer membro logado fala com ele direto, com o
-- próprio JWT:
--
--   - `channel_pairing_links` guarda o TOKEN do link público de pareamento.
--     Quem tem o token pareia um WhatsApp no número da organização. A rota que
--     cria o link exige `manager`; pela policy, um `viewer` lia o token — e
--     podia criar um link novo.
--   - `backoffice_tenants` é o vínculo da organização com o Back Office de
--     afiliados (código de afiliado, plano, valor). Um membro qualquer podia
--     reescrevê-lo.
--
-- Nas duas, quem ESCREVE é o servidor (service role: as rotas de pareamento e
-- `lib/backoffice/tenants.ts`), que bypassa RLS. Então: leitura só para o papel
-- que a tela usa, e escrita revogada de `authenticated` e `anon`.
--
-- Idempotente: `drop policy if exists` + `create policy`, e REVOKE repetido não
-- falha.

drop policy if exists tenant_isolation_channel_pairing_links_all on public.channel_pairing_links;
drop policy if exists pareamento_le_gerente on public.channel_pairing_links;
create policy pareamento_le_gerente on public.channel_pairing_links
  for select
  using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'manager')
  );
revoke insert, update, delete on public.channel_pairing_links from authenticated, anon;

drop policy if exists tenant_isolation_backoffice_tenants_all on public.backoffice_tenants;
drop policy if exists backoffice_le_admin on public.backoffice_tenants;
create policy backoffice_le_admin on public.backoffice_tenants
  for select
  using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  );
revoke insert, update, delete on public.backoffice_tenants from authenticated, anon;
