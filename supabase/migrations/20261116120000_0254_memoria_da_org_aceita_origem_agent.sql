-- 0254 · Memória da organização aceita a origem 'agent'.
--
-- O DEFEITO. A ferramenta `crm_save_org_memory` (lib/mcp/tools/evolucao.ts)
-- grava `source = 'agent'`, para a tela distinguir o que a IA anotou do que uma
-- pessoa escreveu — é o que a ferramenta promete na própria descrição e o que
-- docs/agentes/01, 03 e 09 descrevem. Mas o CHECK criado na 0067 só aceita
-- `manual` e `flywheel`: toda chamada da ferramenta morria com 23514
-- (check_violation), e o agente recebia erro em vez de anotar.
--
-- A CORREÇÃO. O CHECK passa a aceitar os três valores. Nenhuma linha existente
-- muda: nenhuma podia ter 'agent', justamente porque o CHECK recusava.
--
-- Idempotente: `drop constraint if exists` + `add constraint` com o mesmo nome
-- que o Postgres deu ao CHECK inline da 0067.

alter table public.org_memory_entries
  drop constraint if exists org_memory_entries_source_check;

alter table public.org_memory_entries
  add constraint org_memory_entries_source_check
  check (source in ('manual', 'flywheel', 'agent'));
