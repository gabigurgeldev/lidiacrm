-- 0250 · Agente de suporte in-app: o histórico das conversas com a assistente.
--
-- A assistente (bolinha no canto da tela, módulo `agente/`) tira dúvida de uso
-- e lê dados SÓ da conta de quem pergunta. Estas duas tabelas guardam o que foi
-- perguntado e respondido, com tokens e custo — é delas que sai o limite diário
-- de mensagens por pessoa (`AGENTE_LIMITE_DIARIO`).
--
-- ─── Quem lê, quem escreve ───────────────────────────────────────────────────
-- LER: só a própria pessoa (`user_id = auth.uid()`). Nem gerente, nem admin da
-- organização, nem platform admin lê a conversa de outro usuário com a
-- assistente pelo PostgREST: é uma conversa de ajuda, não um registro de
-- atendimento ao cliente da empresa.
--
-- ESCREVER: ninguém pelo cliente. Não há policy de INSERT/UPDATE/DELETE para
-- `authenticated`, e o GRANT de escrita é revogado (não só a policy) — a anon
-- key vai para o navegador, e um INSERT forjado de 50 linhas `role='user'`
-- esgotaria o limite de outra pessoa se a escrita estivesse aberta. Quem grava é
-- o servidor, num arquivo isolado (`agente/registro.server.ts`), com o
-- `user_id` vindo da sessão.
--
-- `organization_id` é a organização ATIVA no momento da pergunta. O `on delete
-- cascade` segue a regra do repo para tabela tenant-aware: a organização sai,
-- o histórico de ajuda dela sai junto.
--
-- Aditiva e idempotente: `create ... if not exists`, `drop policy if exists`.

create table if not exists public.agente_conversas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists agente_conversas_user_created_idx
  on public.agente_conversas (user_id, created_at desc);

create table if not exists public.agente_mensagens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversa_id uuid not null references public.agente_conversas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Fechado: o histórico guarda só a pergunta e a resposta final. O resultado
  -- das ferramentas NÃO é gravado (pode trazer nome de cliente); o que fica é
  -- QUAIS ferramentas rodaram, em `tool_calls`.
  -- A resposta final, em texto, PODE citar nome de cliente: este histórico
  -- ainda não entra no redact da LGPD nem na retenção (follow-up).
  role text not null,
  content text not null,
  tool_calls jsonb,
  tokens_in integer,
  tokens_out integer,
  custo_usd numeric(12, 6),
  modelo text,
  created_at timestamptz not null default now(),
  constraint agente_mensagens_role_check check (role = any (array['user'::text, 'assistant'::text]))
);

-- O limite diário conta `role='user'` da pessoa desde o início do dia.
create index if not exists agente_mensagens_user_created_idx
  on public.agente_mensagens (user_id, created_at);

create index if not exists agente_mensagens_conversa_created_idx
  on public.agente_mensagens (conversa_id, created_at);

alter table public.agente_conversas enable row level security;
alter table public.agente_mensagens enable row level security;

drop policy if exists agente_conversas_select on public.agente_conversas;
create policy agente_conversas_select on public.agente_conversas
  for select using (user_id = auth.uid());

drop policy if exists agente_mensagens_select on public.agente_mensagens;
create policy agente_mensagens_select on public.agente_mensagens
  for select using (user_id = auth.uid());

revoke all on public.agente_conversas from anon;
revoke all on public.agente_mensagens from anon;
revoke insert, update, delete, truncate on public.agente_conversas from authenticated;
revoke insert, update, delete, truncate on public.agente_mensagens from authenticated;
grant select on public.agente_conversas to authenticated;
grant select on public.agente_mensagens to authenticated;
grant all on public.agente_conversas to service_role;
grant all on public.agente_mensagens to service_role;

comment on table public.agente_conversas is
  'Agente de suporte (0250): uma conversa de ajuda de um usuário com a assistente in-app. Lê só o dono; escreve só o servidor.';
comment on table public.agente_mensagens is
  'Agente de suporte (0250): pergunta (user) e resposta (assistant), com tokens e custo. Base do limite diário por usuário.';

notify pgrst, 'reload schema';
