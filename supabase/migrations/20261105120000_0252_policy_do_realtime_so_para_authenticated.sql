-- 0252 · Policy de tabela publicada no Realtime vale só para `authenticated`.
--
-- O DEFEITO, medido em produção. Toda policy das tabelas da publicação
-- `supabase_realtime` foi criada sem `TO`, ou seja, para PUBLIC — e todas chamam
-- uma função `security definer` (`fn_user_org_ids`, `fn_can_view_conversation`,
-- `fn_is_platform_admin`…) de que a varredura da 0116 tirou o EXECUTE de anon.
-- Resultado: anon lendo `conversations` não recebe zero linhas, recebe ERRO —
-- `permission denied for function fn_can_view_conversation`.
--
-- No PostgREST isso é inofensivo (a requisição anônima falha). No Realtime não:
-- `realtime.list_changes` avalia a policy de CADA assinatura dentro de UMA
-- consulta só. Basta uma assinatura com papel anon — um navegador cujo token não
-- chegou ao socket, ou qualquer pessoa com a anon key, que vai para o browser —
-- para a consulta inteira falhar (`PoolingReplicationError`) e o tempo real
-- parar para TODAS as organizações da instalação enquanto ela existir. Na
-- produção que motivou isto, a falha coincidiu, minuto a minuto, com uma aba em
-- laço de reassinatura que saturou a CPU da VPS.
--
-- A CORREÇÃO. Com a policy restrita a `authenticated`, anon não tem policy que
-- se aplique: a RLS nega em silêncio (zero linhas) e nenhuma função é chamada.
-- Ninguém perde acesso — anon já não lia nada dessas tabelas, só recebia erro.
-- `service_role` segue ignorando RLS, e `authenticated` segue com a mesma regra.
--
-- POR QUE UMA VARREDURA E NÃO UMA LISTA. As tabelas publicadas mudam (a agenda
-- entrou na 0249) e um clone pode ter publicado outra. A varredura pega toda
-- policy de toda tabela publicada no schema `public`, qualquer comando, que
-- valha para PUBLIC ou anon. Idempotente: na segunda passada não acha nada.
-- No `baseline.sql` ela mora DENTRO do bloco final (a varredura de anon da
-- 0116), para curar também policy recriada por apêndice futuro.
--
-- Vigiado por `tests/invariants/realtime-policy-nao-vale-para-anon.test.ts`.

do $$
declare
  p record;
begin
  if to_regrole('authenticated') is null then
    return;
  end if;

  for p in
    select n.nspname as esquema, c.relname as tabela, pol.polname as policy
      from pg_policy pol
      join pg_class c on c.oid = pol.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_publication_tables t
        on t.pubname = 'supabase_realtime'
       and t.schemaname = n.nspname
       and t.tablename = c.relname
     where n.nspname = 'public'
       and (
         0::oid = any (pol.polroles)
         or (to_regrole('anon') is not null and to_regrole('anon')::oid = any (pol.polroles))
       )
  loop
    execute format(
      'alter policy %I on %I.%I to authenticated',
      p.policy, p.esquema, p.tabela
    );
  end loop;
end $$;
