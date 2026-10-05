-- ============================================================================
-- 0224 — CONTRATO DE SUPORTE v1: quais organizações um e-mail administra.
--
-- O agente de suporte da Gestalt consulta contas DESTA instalação por
-- `/suporte/v1/*` (docs/integracoes/contrato-de-suporte-v1.md). O primeiro
-- passo é `POST /identidade/buscar {email}`: dado o e-mail que o cliente
-- informou no WhatsApp, quais organizações ele administra? Depois de provar o
-- e-mail com o código, cada chamada a `/contas/{org}` confere DE NOVO, por esta
-- mesma função, que aquele e-mail ainda administra aquela organização.
--
-- ═══ Por que uma função, e não `auth.admin.listUsers` ═══
--
-- `listUsers` é paginado e varre a base inteira de usuários a cada busca — num
-- caminho que roda a cada pedido de código e a cada consulta do agente. Aqui é
-- um join indexado por e-mail.
--
-- ═══ Quem conta como dono ═══
--
-- Só vínculo ACEITO e ativo, com papel `admin` ou `manager`. Um `agent` ou
-- `viewer` não decide reconectar o WhatsApp da empresa nem devolver conversa
-- ao robô — e o agente de suporte não pode fazer por ele o que a tela não deixa.
--
-- ═══ Exposição ═══
--
-- `security definer` porque lê `auth.users`. As DUAS origens de EXECUTE são
-- revogadas (PUBLIC e anon) e também `authenticated`: só o service role chama,
-- e só de dentro de `lib/suporte/rota.ts`, depois do HMAC.
-- ============================================================================

create or replace function public.fn_suporte_contas_por_email(p_email text)
returns table (organization_id uuid, nome text, papel text)
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select o.id, coalesce(o.display_name, o.legal_name, o.slug), uo.role
    from auth.users u
    join public.user_organizations uo on uo.user_id = u.id
    join public.organizations o on o.id = uo.organization_id
   where lower(u.email) = lower(trim(p_email))
     and uo.accepted_at is not null
     and uo.revoked_at is null
     and uo.role in ('admin', 'manager')
   order by o.created_at, o.id
   limit 20;
$$;

revoke execute on function public.fn_suporte_contas_por_email(text) from public, anon, authenticated;
grant execute on function public.fn_suporte_contas_por_email(text) to service_role;

comment on function public.fn_suporte_contas_por_email(text) is
  'Contrato de Suporte v1: organizações que um e-mail administra (admin/manager, vínculo aceito). Só service_role — chamada por lib/suporte/rota.ts depois do HMAC.';

notify pgrst, 'reload schema';
