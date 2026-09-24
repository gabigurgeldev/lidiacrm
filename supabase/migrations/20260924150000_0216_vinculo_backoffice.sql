-- 0216 — vínculo da organização com o Back Office de afiliados da Gestalt.
--
-- ═══ O problema ═══
--
-- O Back Office (sistema central de afiliados e comissões) cria contas neste CRM
-- sem ninguém entrar no painel de plataforma: chama `POST /backoffice/tenants`,
-- que abre a organização e convida o dono. O Back Office pode repetir o MESMO
-- pedido (timeout, queda no meio) e a segunda chamada não pode abrir uma segunda
-- empresa — por isso cada pedido carrega um `request_id` fixo, e este vínculo é
-- onde ele fica guardado.
--
-- ═══ Por que TABELA, e não `organizations.settings` (doutrina DIRC) ═══
--
-- `request_id` precisa de UNIQUE para a idempotência valer sob corrida, e jsonb
-- não tem unique. Plano e valor que o Back Office cobra também moram aqui: são
-- dados do CONTRATO com a Gestalt, não configuração do CRM, e não se confundem
-- com `settings.plan` (standard/pro/enterprise), que continua sendo o do CRM.
--
-- Organização sem linha aqui = criada por outro caminho (signup, painel de
-- plataforma). O Back Office só enxerga as que ele criou.

create table if not exists public.backoffice_tenants (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  request_id uuid not null unique,
  affiliate_code text,
  plan_name text,
  plan_amount_cents integer,
  owner_email citext not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.backoffice_tenants
  drop constraint if exists backoffice_tenants_valor_nao_negativo;
alter table public.backoffice_tenants
  add constraint backoffice_tenants_valor_nao_negativo check (plan_amount_cents is null or plan_amount_cents >= 0);

-- Conciliação do Back Office: "o que mudou desde ontem?".
create index if not exists backoffice_tenants_atualizado_idx
  on public.backoffice_tenants (updated_at);

alter table public.backoffice_tenants enable row level security;

drop policy if exists tenant_isolation_backoffice_tenants_all on public.backoffice_tenants;
create policy tenant_isolation_backoffice_tenants_all on public.backoffice_tenants
  for all
  using (organization_id in (select fn_user_org_ids()))
  with check (organization_id in (select fn_user_org_ids()));

comment on table public.backoffice_tenants is
  'Organizações criadas pelo Back Office de afiliados (POST /backoffice/tenants). request_id único garante que o mesmo pedido repetido não abre outra empresa. As rotas /backoffice/* usam service role e resolvem a organização pelo id do caminho, autenticadas por HMAC (BACKOFFICE_OUTBOUND_SECRET).';
