-- 0221 — indicação de afiliado no cadastro e fila de saída para o Back Office.
--
-- ═══ O problema ═══
--
-- O Back Office de afiliados só enxergava as organizações que ele mesmo criava
-- (0216). Quem chegava pelo link de um afiliado e se cadastrava sozinho pagava
-- pelo Asaas sem ninguém saber de quem era a indicação: sem desconto para o
-- cliente, sem comissão para o afiliado, sem receita no painel da Gestalt.
--
-- ═══ As duas tabelas ═══
--
--   backoffice_indicacoes — UMA linha por organização que veio indicada: o
--                           código do afiliado e o desconto (em pontos-base)
--                           que o Back Office devolveu no cadastro. O desconto
--                           vira o `assinaturas.valor_centavos` da organização;
--                           aqui fica o PORQUÊ daquele valor.
--   backoffice_saida      — fila de eventos para `POST /api/v1/events` do Back
--                           Office (cadastro, pagamento, estorno, chargeback,
--                           cancelamento). `event_id` UNIQUE: o webhook do Asaas
--                           e a conciliação horária passam pela MESMA cobrança
--                           muitas vezes, e o evento só pode nascer uma.
--
-- ═══ Por que fila, e não chamada direta ═══
--
-- Doutrina: side effect externo não mora dentro da gravação. O pagamento é
-- gravado, o evento entra na fila na mesma passada, e o envio acontece depois
-- da resposta; o que falhar o cron `backoffice-saida` reenvia com espera
-- crescente. Back Office fora do ar não derruba o webhook do Asaas nem perde
-- comissão.
--
-- ═══ ⚠️ O cliente NÃO lê nem escreve ═══
--
-- Sem policy e com todos os privilégios revogados de `anon`/`authenticated`:
-- quem escreve é só o servidor (service role). Um membro que gravasse a própria
-- indicação escolheria o desconto; um que lesse a fila veria o e-mail do dono.

create table if not exists public.backoffice_indicacoes (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  affiliate_code text not null,
  desconto_bps integer,
  created_at timestamptz not null default now()
);

alter table public.backoffice_indicacoes drop constraint if exists backoffice_indicacoes_codigo_valido;
alter table public.backoffice_indicacoes add constraint backoffice_indicacoes_codigo_valido
  check (affiliate_code ~ '^[A-Z0-9]{3,20}$');
alter table public.backoffice_indicacoes drop constraint if exists backoffice_indicacoes_desconto_valido;
alter table public.backoffice_indicacoes add constraint backoffice_indicacoes_desconto_valido
  check (desconto_bps is null or (desconto_bps >= 0 and desconto_bps <= 10000));

create table if not exists public.backoffice_saida (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  organization_id uuid references public.organizations(id) on delete cascade,
  tipo text not null,
  payload jsonb not null,
  status text not null default 'pendente',
  tentativas integer not null default 0,
  proxima_tentativa_em timestamptz not null default now(),
  ultimo_erro text,
  enviado_em timestamptz,
  created_at timestamptz not null default now()
);

alter table public.backoffice_saida drop constraint if exists backoffice_saida_status_valido;
alter table public.backoffice_saida add constraint backoffice_saida_status_valido
  check (status in ('pendente', 'enviado', 'falhou'));

create index if not exists backoffice_saida_pendentes_idx
  on public.backoffice_saida (proxima_tentativa_em)
  where status = 'pendente';
create index if not exists backoffice_saida_org_idx
  on public.backoffice_saida (organization_id, created_at desc);

alter table public.backoffice_indicacoes enable row level security;
alter table public.backoffice_saida enable row level security;

-- Sem policy nenhuma = invisível ao cliente.
revoke all on public.backoffice_indicacoes from anon, authenticated;
revoke all on public.backoffice_saida from anon, authenticated;

comment on table public.backoffice_indicacoes is
  'Organização que se cadastrou pelo link de um afiliado do Back Office: código e desconto (bps) devolvidos no cadastro. O desconto já está aplicado em assinaturas.valor_centavos. Escrita e leitura só por service role.';
comment on table public.backoffice_saida is
  'Fila de eventos para POST /api/v1/events do Back Office (cadastro, pagamento, estorno, chargeback, cancelamento). event_id UNIQUE; reenvio pelo cron backoffice-saida. Invisível ao cliente.';
