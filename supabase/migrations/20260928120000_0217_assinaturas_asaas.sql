-- 0217 — assinatura paga da organização (Asaas): trial, mensalidade, bloqueio.
--
-- ═══ O problema ═══
--
-- O sistema passa a cobrar: cadastro aberto com 7 dias grátis, depois
-- mensalidade por organização, paga por PIX ou cartão pelo Asaas. Não havia
-- tabela nenhuma de cobrança — a tela de Billing era um "em breve".
--
-- ═══ As três tabelas ═══
--
--   assinaturas     — UMA linha por organização: estado, fim do trial, "pago até",
--                     vínculo com o cliente e a assinatura no Asaas, isenção.
--   cobrancas       — uma linha por cobrança do Asaas (mensalidade), para o
--                     histórico da tela e para recalcular "pago até" num estorno.
--   eventos_asaas   — cada evento de webhook recebido, com `evento_id` UNIQUE: o
--                     Asaas reentrega, e a segunda entrega não pode estender o
--                     acesso de novo (captura de 23505 na rota).
--
-- ═══ Por que o acesso é CALCULADO das datas, e não uma flag ═══
--
-- `lib/billing/acesso.ts` decide "liberado?" a partir de `trial_termina_em` e
-- `pago_ate`. Pagou → o webhook empurra `pago_ate` e a pessoa entra na hora; não
-- pagou → a data passa e o bloqueio acontece sozinho, sem cron nenhum ter de
-- acordar para isso. Uma flag `bloqueado` gravada por cron teria atraso nas duas
-- direções.
--
-- ═══ ⚠️ O cliente NÃO escreve nestas tabelas ═══
--
-- A policy é SÓ de leitura (membros veem a própria assinatura) e os privilégios
-- de escrita são revogados de `anon` e `authenticated`. Sem isso, qualquer membro
-- faria `update assinaturas set pago_ate = '2099-01-01'` pelo PostgREST com a anon
-- key que vai para o navegador, e usaria o sistema de graça para sempre. Quem
-- escreve é só o servidor (service role): webhook autenticado, checkout e o
-- painel da plataforma.
--
-- ═══ Organizações que já existiam ═══
--
-- Decisão do dono: quem já usava o sistema antes da cobrança fica ISENTO. O
-- backfill no fim cria a linha `isenta = true` para toda organização sem linha.
-- É idempotente (`on conflict do nothing`) e nunca mexe em linha existente.

create table if not exists public.assinaturas (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  status text not null default 'trial',
  isenta boolean not null default false,
  trial_termina_em timestamptz,
  pago_ate timestamptz,
  metodo text,
  asaas_customer_id text,
  asaas_subscription_id text unique,
  cartao_final text,
  cartao_bandeira text,
  valor_centavos integer not null default 120000,
  moeda text not null default 'BRL',
  cancelada_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.assinaturas drop constraint if exists assinaturas_status_valido;
alter table public.assinaturas add constraint assinaturas_status_valido
  check (status in ('trial', 'ativa', 'inadimplente', 'cancelada'));
alter table public.assinaturas drop constraint if exists assinaturas_metodo_valido;
alter table public.assinaturas add constraint assinaturas_metodo_valido
  check (metodo is null or metodo in ('PIX', 'CREDIT_CARD'));
alter table public.assinaturas drop constraint if exists assinaturas_valor_nao_negativo;
alter table public.assinaturas add constraint assinaturas_valor_nao_negativo
  check (valor_centavos >= 0);

create index if not exists assinaturas_asaas_customer_idx on public.assinaturas (asaas_customer_id);

create table if not exists public.cobrancas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asaas_payment_id text not null unique,
  asaas_subscription_id text,
  valor_centavos integer not null,
  moeda text not null default 'BRL',
  metodo text,
  status text not null,
  vencimento date,
  pago_em timestamptz,
  url_fatura text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cobrancas_org_vencimento_idx
  on public.cobrancas (organization_id, vencimento desc);

create table if not exists public.eventos_asaas (
  id uuid primary key default gen_random_uuid(),
  evento_id text not null unique,
  tipo text not null,
  organization_id uuid references public.organizations(id) on delete set null,
  payload jsonb not null,
  recebido_em timestamptz not null default now(),
  processado_em timestamptz,
  erro text
);

create index if not exists eventos_asaas_org_idx on public.eventos_asaas (organization_id, recebido_em desc);

-- RLS: membros LEEM a própria assinatura e cobranças; ninguém escreve pelo cliente.
alter table public.assinaturas enable row level security;
alter table public.cobrancas enable row level security;
alter table public.eventos_asaas enable row level security;

drop policy if exists assinaturas_select on public.assinaturas;
create policy assinaturas_select on public.assinaturas
  for select using (organization_id in (select fn_user_org_ids()));

drop policy if exists cobrancas_select on public.cobrancas;
create policy cobrancas_select on public.cobrancas
  for select using (organization_id in (select fn_user_org_ids()));

-- eventos_asaas: sem policy nenhuma = invisível ao cliente (payload do gateway).

revoke insert, update, delete, truncate on public.assinaturas from anon, authenticated;
revoke insert, update, delete, truncate on public.cobrancas from anon, authenticated;
revoke all on public.eventos_asaas from anon, authenticated;

comment on table public.assinaturas is
  'Assinatura paga da organização (Asaas). Acesso calculado em lib/billing/acesso.ts a partir de trial_termina_em e pago_ate. Escrita só por service role — a policy é de leitura e os grants de escrita foram revogados de anon/authenticated.';
comment on table public.cobrancas is
  'Cobranças do Asaas por organização (histórico e base para recalcular pago_ate em estorno). Escrita só por service role.';
comment on table public.eventos_asaas is
  'Eventos de webhook do Asaas; evento_id UNIQUE torna a reentrega idempotente. Invisível ao cliente.';

-- Backfill: organizações que já existiam ficam isentas (decisão do dono).
--
-- ⚠️ SÓ NA PRIMEIRA APLICAÇÃO (tabela vazia). O `update.sh` re-aplica o
-- apêndice do baseline a cada atualização; um backfill incondicional isentaria,
-- na próxima atualização, qualquer organização nova que por algum motivo ainda
-- não tivesse linha — e isenção é para sempre. Depois do primeiro lote, a linha
-- de toda organização nova nasce no código (`lib/billing/servico.ts`), e uma
-- org sem linha é tratada lá como trial contado do `created_at`, nunca como isenta.
do $$
begin
  if not exists (select 1 from public.assinaturas) then
    insert into public.assinaturas (organization_id, status, isenta)
    select o.id, 'ativa', true
      from public.organizations o
    on conflict (organization_id) do nothing;
  end if;
end $$;
