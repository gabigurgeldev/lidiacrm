-- 0213 — link público de pareamento por QR.
--
-- ═══ O problema ═══
--
-- O QR só existe dentro do CRM, logado (`ConnectionsClient`, num Dialog). Para
-- conectar o WhatsApp de um cliente, ou ele manda print do QR — que expira em
-- ~20s e chega morto —, ou alguém opera o CRM ao lado dele. Este link resolve:
-- quem tem acesso gera, manda pro dono do número, ele abre no próprio celular.
--
-- ═══ Por que TABELA, e não colunas em channel_sessions (doutrina DIRC) ═══
--
-- Um link tem ciclo de vida PRÓPRIO — nasce, expira, é cancelado, é consumido —
-- e há vários ao longo do tempo para a mesma linha. Isso é entidade, não
-- atributo: em `channel_sessions` seria um punhado de colunas que só valem para
-- o último link, e o histórico de "gerei três e nenhum foi usado" — que é o
-- sinal de que a ativação do cliente emperrou — não existiria.
--
-- ═══ Por que 192 bits de token ═══
--
-- `gen_random_bytes(24)` em hex, o mesmo gerador de `tenant_integrations`, e
-- NÃO o `uuid_generate_v4()` de `channel_sessions.webhook_path_token`, que tem
-- 122 bits de entropia. Este token é a única coisa entre a internet e o
-- pareamento de um aparelho na operação de um cliente: quem tem o link pareia.
-- Por isso ele também é curto de vida (30 min, escrito por quem cria) e morre
-- ao ser usado (`consumed_at`).
--
-- Três colunas de morte em vez de um `status text`: elas não são exclusivas
-- entre si (um link pode ser consumido e depois expirar o relógio) e cada uma
-- carrega QUANDO, que é o dado que responde "por que este cliente não conectou".

create table if not exists public.channel_pairing_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel_session_id uuid not null references public.channel_sessions(id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  expires_at timestamptz not null,
  created_by uuid references auth.users(id) on delete set null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- Prazo no futuro: um link nascido vencido é um link que ninguém consegue usar
-- e que nada denuncia. Mesma forma da constraint de `crm_lead_reactivations`.
alter table public.channel_pairing_links
  drop constraint if exists channel_pairing_links_prazo_no_futuro;
alter table public.channel_pairing_links
  add constraint channel_pairing_links_prazo_no_futuro check (expires_at > created_at);

-- A busca pública é sempre por token (o unique já a atende). Esta é a do CRM:
-- "qual o link vivo desta linha?".
create index if not exists channel_pairing_links_por_canal_idx
  on public.channel_pairing_links (channel_session_id, created_at desc);

alter table public.channel_pairing_links enable row level security;

drop policy if exists tenant_isolation_channel_pairing_links_all on public.channel_pairing_links;
create policy tenant_isolation_channel_pairing_links_all on public.channel_pairing_links
  for all
  using (organization_id in (select fn_user_org_ids()))
  with check (organization_id in (select fn_user_org_ids()));

comment on table public.channel_pairing_links is
  'Link público e temporário para parear um WhatsApp por QR sem entrar no CRM. Quem tem o token pareia: 30 min de vida, morre ao ser usado (consumed_at) e pode ser cancelado (revoked_at). As rotas públicas resolvem organization_id A PARTIR do token, nunca do corpo.';
