-- 0214 — as duas tabelas de execução de fluxo entram na publicação realtime.
--
-- ═══ Por que ═══
--
-- A tela de execuções de um fluxo mostra o contato que disparou e os passos
-- avançando AO VIVO. Sem a tabela na publicação, o canal do Supabase assina,
-- reporta `SUBSCRIBED` e **não entrega nada, para sempre, em silêncio** — o
-- modo de falha mais caro possível numa tela cujo propósito é ser ao vivo.
--
-- `tests/unit/realtime-assinatura-tem-publicacao.test.ts` reprova qualquer
-- `table: "..."` num arquivo com `postgres_changes` que não esteja aqui, e ele
-- lê o `baseline.sql` — por isso o apêndice do baseline acompanha, e não só
-- este arquivo.
--
-- ═══ As DUAS, e o que cada uma serve ═══
--
--  - `flow_executions`   — a linha da execução: estado, bloco atual, contato.
--    É o que faz a lista aparecer e mudar de cor sozinha.
--  - `flow_execution_events` — a trilha por nó. É o que faz o passo a passo
--    andar na tela enquanto o fluxo caminha. Sem ela, a lista se mexe mas o
--    detalhe da execução fica congelado até um F5.
--
-- ═══ `replica identity` fica como está (default) ═══
--
-- Ligar `full` aumentaria o WAL de TODA escrita das duas tabelas — e elas são
-- as mais escritas do motor, um insert por nó visitado. O que a tela precisa é
-- INSERT e UPDATE, que já trazem a linha nova inteira. DELETE traria só a PK,
-- e execução não é apagada no caminho normal: `flow_execution_events` só some
-- por cascade quando a execução some. Fica declarado aqui para não ser
-- descoberto em produção.
--
-- Aditiva e idempotente: só acrescenta tabela à publicação, com a mesma guarda
-- de `pg_publication_tables` que o baseline e a migration 0183 já usam.

do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'flow_executions'
  ) then
    execute 'alter publication supabase_realtime add table public.flow_executions';
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'flow_execution_events'
  ) then
    execute 'alter publication supabase_realtime add table public.flow_execution_events';
  end if;
end $$;
