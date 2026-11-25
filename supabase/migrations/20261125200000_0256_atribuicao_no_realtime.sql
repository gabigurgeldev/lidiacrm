-- 0256_atribuicao_no_realtime — o aviso de "lead novo para você" chega ao navegador.
--
-- O QUÊ: `conversation_assignment_events` entra na publicação `supabase_realtime`,
-- e as duas policies da tabela passam a valer só para `authenticated` (regra 3 da
-- migration 0252: policy de tabela publicada não vale para anon).
--
-- POR QUÊ: o som de aviso (Configurações › Notificações) precisa avisar a
-- atendente quando uma conversa nova cai para ela. Nas orgs com visibilidade "só
-- as minhas", a primeira mensagem chega INVISÍVEL para ela: a conversa ainda não
-- tem dono, então o INSERT em `messages` não passa pela RLS dela e o aviso de
-- mensagem não dispara. O que torna a conversa dela é a atribuição.
--
-- Por que esta tabela e não o UPDATE em `conversations`: com replica identity
-- default, o registro antigo de um UPDATE leva só a chave primária, e a hipótese
-- registrada em `tests/sonda-replica-identity.ts` (não confirmada nem descartada)
-- é que o Realtime descarta esse evento ao avaliar a RLS sobre ele. Um INSERT não
-- tem registro antigo. `fn_conversation_assign` grava esta linha e o novo dono na
-- MESMA transação, então, quando o Realtime avalia `cae_select` (que herda a
-- visibilidade da conversa), a atendente já enxerga a conversa.
--
-- Nenhuma linha muda. Idempotente: guarda em `pg_publication_tables`, e `alter
-- policy ... to` pode ser reaplicado.

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'conversation_assignment_events'
  ) then
    alter publication supabase_realtime add table public.conversation_assignment_events;
  end if;
end $$;

do $$
begin
  if to_regrole('authenticated') is null then
    return;
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'conversation_assignment_events' and policyname = 'cae_select'
  ) then
    alter policy cae_select on public.conversation_assignment_events to authenticated;
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'conversation_assignment_events' and policyname = 'cae_insert'
  ) then
    alter policy cae_insert on public.conversation_assignment_events to authenticated;
  end if;
end $$;
