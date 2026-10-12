-- 0240 — a versão do agente diz o que mudou nela
--
-- "Corrigir com IA" (lib/ai/agents/correcao/aplicar.ts) grava um rascunho a
-- partir de um problema relatado. Sem uma linha dizendo isso, o histórico de
-- versões mostrava só "v7 · rascunho" — e quem abre o editor depois não sabe
-- que aquela versão nasceu de "o agente está dando desconto sem autorização",
-- nem tem o que comparar quando o problema volta.
--
-- `change_summary` é METADADO, não conteúdo: fica de fora do trigger
-- `fn_ai_agent_version_content_immutable` de propósito — não muda o que o
-- agente faz, e editar a nota de uma versão publicada não é publicar nada.
--
-- Nullable, sem default: versões antigas não têm resumo, e nenhum caminho
-- antigo precisa gravar. Só acrescenta coluna. Idempotente.

alter table public.ai_agent_versions
  add column if not exists change_summary text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'ai_agent_versions_change_summary_len'
       and conrelid = 'public.ai_agent_versions'::regclass
  ) then
    alter table public.ai_agent_versions
      add constraint ai_agent_versions_change_summary_len
      check (change_summary is null or char_length(change_summary) <= 500);
  end if;
end $$;

comment on column public.ai_agent_versions.change_summary is
  'O que mudou nesta versão, em uma linha (ex.: "Correção com IA: <problema>"). Metadado: fora do trigger de imutabilidade.';

notify pgrst, 'reload schema';
