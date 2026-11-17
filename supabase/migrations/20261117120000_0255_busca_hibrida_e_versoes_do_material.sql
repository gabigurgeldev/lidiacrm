-- 0255 · Busca híbrida no material + versões do material atômicas e podadas.
--
-- QUATRO DEFEITOS, UMA MIGRATION (todos no caminho "o agente procura no material"):
--
-- 1. A BUSCA ERA SÓ POR VETOR. Pergunta com SKU, código ou preço ("tem o
--    AB-1234?", "o de 49,90") é exatamente o que o vetor mais erra: a
--    similaridade semântica de um código é ruído. Agora há uma coluna `tsv`
--    (texto normalizado, configuração `simple` — sem stemmer, para não cortar
--    código nem número) e a função `fn_buscar_trechos_hibrido` devolve os
--    candidatos do vetor E os do texto, cada um com a sua posição. A fusão (RRF)
--    e a reordenação (rerank) acontecem no TypeScript.
--
-- 2. O ÍNDICE IVFFLAT COM 100 LISTAS. Com `probes = 1` (o padrão), cada busca
--    olha UMA lista de cem — sobre um acervo de algumas centenas de trechos,
--    isso é ler ~1% do material e devolver o melhor desse 1%. A busca híbrida
--    é EXATA sobre o material ativo da organização (CTE materializada: o acervo
--    ativo de um tenant é pequeno e a varredura custa milissegundos); o HNSW
--    substitui o ivfflat para quem ainda usa a função antiga. HNSW só existe a
--    partir do pgvector 0.5 — instalação mais velha mantém o ivfflat.
--
-- 3. ATIVAR UMA VERSÃO ERAM TRÊS UPDATES SOLTOS (`lib/ai/rag/version.ts`). Se
--    o segundo caísse, a fonte ficava sem versão ativa e o material "sumia".
--    `fn_ativar_versao_kb` faz os três numa transação, com a fonte trancada.
--
-- 4. VERSÃO VELHA NUNCA SAÍA. Cada reindexação deixava os trechos da anterior
--    para sempre. `fn_expurgar_versoes_do_material` apaga os trechos de versões
--    inativas vencidas, preservando SEMPRE a ativa e as duas mais recentes de
--    cada fonte (rollback).
--
-- E UMA PEÇA PARA O CONSERTO DA INGESTÃO INCREMENTAL: `fn_derivar_versao_kb`
-- copia para a versão nova os trechos da ativa MENOS os de um item (o produto
-- que mudou). Antes, a sincronização de um produto ativava uma versão contendo
-- só aquele produto — e o resto do catálogo sumia da busca.
--
-- Idempotente e portável em psql puro.

-- ---- 1. coluna de texto + índice ----
alter table public.ai_chunks
  add column if not exists tsv tsvector
  generated always as (
    to_tsvector('simple', translate(lower(content),
      'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'))
  ) stored;

create index if not exists ai_chunks_tsv_idx on public.ai_chunks using gin (tsv);

-- ---- 2. HNSW no lugar do ivfflat (só com pgvector >= 0.5) ----
do $$
declare
  v_versao int[];
begin
  select string_to_array(split_part(extversion, '-', 1), '.')::int[]
    into v_versao
    from pg_extension where extname = 'vector';
  if v_versao is not null and v_versao >= array[0, 5, 0] then
    execute 'create index if not exists ai_chunks_embedding_hnsw_idx on public.ai_chunks using hnsw (embedding public.vector_cosine_ops)';
    execute 'drop index if exists public.ai_chunks_embedding_ivfflat_idx';
  end if;
end $$;

-- ---- 3. a busca híbrida ----
create or replace function public.fn_buscar_trechos_hibrido(
  p_organization_id uuid,
  p_source_ids uuid[],
  p_embedding public.vector,
  p_termos text[],
  p_k integer default 20,
  p_embedding_model text default null
) returns table(
  chunk_id uuid,
  knowledge_source_id uuid,
  source_name text,
  content text,
  similarity real,
  metadata jsonb,
  rank_vetor integer,
  rank_texto integer
)
  language plpgsql stable security definer
  set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_q tsquery;
  v_k integer := least(greatest(coalesce(p_k, 20), 0), 200);
begin
  if auth.uid() is not null
     and not public.fn_role_at_least(p_organization_id, 'viewer') then
    raise exception 'caller_not_authorized_for_org'
      using hint = 'fn_buscar_trechos_hibrido: caller must be an active member of the organization';
  end if;

  -- Só termos já normalizados pelo chamador entram (a-z0-9). O filtro aqui é a
  -- segunda tranca: nenhum operador de tsquery chega ao `to_tsquery`.
  select to_tsquery('simple', string_agg(t, ' | '))
    into v_q
    from unnest(coalesce(p_termos, '{}'::text[])) as t
   where t ~ '^[a-z0-9]{2,40}$';

  return query
  with ativos as materialized (
    select c.id, c.knowledge_source_id as fonte, s.name as nome, c.content as texto,
           c.embedding as vetor, c.metadata as meta, c.tsv as tsv
      from public.ai_chunks c
      join public.ai_knowledge_sources s
        on s.id = c.knowledge_source_id
       and s.organization_id = c.organization_id
      join public.ai_knowledge_versions v
        on v.id = c.kb_version_id
     where c.organization_id = p_organization_id
       and s.id = any(p_source_ids)
       and s.is_active
       and s.status = 'ready'
       and c.kb_version_id = s.active_kb_version_id
       and (
         p_embedding_model is null
         or v.embedding_model is null
         or v.embedding_model = p_embedding_model
       )
  ),
  por_vetor as (
    select a.id, (row_number() over (order by a.vetor <=> p_embedding asc))::int as r
      from ativos a
     order by a.vetor <=> p_embedding asc
     limit v_k
  ),
  por_texto as (
    select a.id, (row_number() over (order by ts_rank_cd(a.tsv, v_q) desc))::int as r
      from ativos a
     where v_q is not null and a.tsv @@ v_q
     order by ts_rank_cd(a.tsv, v_q) desc
     limit v_k
  ),
  escolhidos as (
    select pv.id from por_vetor pv
    union
    select pt.id from por_texto pt
  )
  select a.id, a.fonte, a.nome, a.texto,
         (1 - (a.vetor <=> p_embedding))::real,
         a.meta, pv.r, pt.r
    from escolhidos e
    join ativos a on a.id = e.id
    left join por_vetor pv on pv.id = a.id
    left join por_texto pt on pt.id = a.id;
end $$;

comment on function public.fn_buscar_trechos_hibrido(uuid, uuid[], public.vector, text[], integer, text) is
  'Candidatos do material ativo por vetor (exato) e por texto (tsvector simple), com a posição em cada lista. Fusão e rerank no chamador (0255). SECURITY DEFINER + filtro programático de organização.';

revoke execute on function public.fn_buscar_trechos_hibrido(uuid, uuid[], public.vector, text[], integer, text) from public, anon;
grant  execute on function public.fn_buscar_trechos_hibrido(uuid, uuid[], public.vector, text[], integer, text) to authenticated, service_role;

-- ---- 4. ativação atômica ----
create or replace function public.fn_ativar_versao_kb(
  p_organization_id uuid,
  p_source_id uuid,
  p_version_id uuid
) returns void
  language plpgsql security definer
  set search_path to 'public'
as $$
begin
  -- A fonte trancada serializa duas ativações concorrentes do mesmo material.
  perform 1 from public.ai_knowledge_sources
   where id = p_source_id and organization_id = p_organization_id
   for update;
  if not found then
    raise exception 'fonte_nao_encontrada' using hint = 'fn_ativar_versao_kb';
  end if;

  if not exists (
    select 1 from public.ai_knowledge_versions
     where id = p_version_id
       and knowledge_source_id = p_source_id
       and organization_id = p_organization_id
  ) then
    raise exception 'versao_nao_pertence_a_fonte' using hint = 'fn_ativar_versao_kb';
  end if;

  -- Desativar a anterior ANTES: o índice único `ai_kbv_uma_ativa_por_fonte`
  -- recusaria duas ativas ao mesmo tempo.
  update public.ai_knowledge_versions
     set is_active = false
   where knowledge_source_id = p_source_id
     and organization_id = p_organization_id
     and id <> p_version_id
     and is_active;

  update public.ai_knowledge_versions
     set is_active = true, activated_at = now()
   where id = p_version_id and organization_id = p_organization_id;

  update public.ai_knowledge_sources
     set active_kb_version_id = p_version_id
   where id = p_source_id and organization_id = p_organization_id;
end $$;

revoke execute on function public.fn_ativar_versao_kb(uuid, uuid, uuid) from public, anon, authenticated;
grant  execute on function public.fn_ativar_versao_kb(uuid, uuid, uuid) to service_role;

-- ---- 5. versão derivada (ingestão incremental) ----
-- Copia para `p_nova_versao` os trechos da versão ATIVA da fonte, exceto os
-- cujo `metadata ->> p_chave` está em `p_valores` (o item que mudou). Devolve
-- quantos copiou — e a cópia ocupa as posições 0..n-1, então o chamador grava
-- os trechos novos a partir de n.
create or replace function public.fn_derivar_versao_kb(
  p_organization_id uuid,
  p_source_id uuid,
  p_nova_versao uuid,
  p_chave text,
  p_valores text[]
) returns integer
  language plpgsql security definer
  set search_path to 'public'
as $$
declare
  v_ativa uuid;
  v_copiados integer;
begin
  if not exists (
    select 1 from public.ai_knowledge_versions
     where id = p_nova_versao
       and knowledge_source_id = p_source_id
       and organization_id = p_organization_id
       and status = 'building'
  ) then
    raise exception 'versao_nova_invalida' using hint = 'fn_derivar_versao_kb: a versão precisa ser desta fonte e estar em building';
  end if;

  select active_kb_version_id into v_ativa
    from public.ai_knowledge_sources
   where id = p_source_id and organization_id = p_organization_id;
  if v_ativa is null then
    return 0;
  end if;

  insert into public.ai_chunks
    (organization_id, knowledge_source_id, kb_version_id, position,
     content, content_hash, token_count, embedding, metadata)
  select c.organization_id, c.knowledge_source_id, p_nova_versao,
         (row_number() over (order by c.position) - 1)::int,
         c.content, c.content_hash, c.token_count, c.embedding, c.metadata
    from public.ai_chunks c
   where c.organization_id = p_organization_id
     and c.knowledge_source_id = p_source_id
     and c.kb_version_id = v_ativa
     and coalesce(c.metadata ->> p_chave, '') <> all (coalesce(p_valores, '{}'::text[]));
  get diagnostics v_copiados = row_count;
  return v_copiados;
end $$;

revoke execute on function public.fn_derivar_versao_kb(uuid, uuid, uuid, text, text[]) from public, anon, authenticated;
grant  execute on function public.fn_derivar_versao_kb(uuid, uuid, uuid, text, text[]) to service_role;

-- ---- 6. poda das versões velhas ----
-- Apaga trechos de versões que: não são a ativa, não são o ponteiro da fonte,
-- não estão em `building`, nasceram há mais de N dias, e não estão entre as
-- duas mais recentes da fonte. Sem seletor de organização: o critério é só
-- idade e posição, igual ao das outras podas.
create or replace function public.fn_expurgar_versoes_do_material(
  p_retencao_dias int default null,
  p_limite int default null
) returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dias int := greatest(coalesce(p_retencao_dias, 7), 1);
  v_limite int := least(greatest(coalesce(p_limite, 1000), 1), 10000);
  v_apagados int;
begin
  with ranqueadas as (
    select v.id,
           v.knowledge_source_id,
           v.is_active,
           v.status,
           v.created_at,
           row_number() over (partition by v.knowledge_source_id order by v.version_number desc) as ordem
      from public.ai_knowledge_versions v
     -- Versão sem fonte é anterior à 0181 (trechos de várias fontes numa só) e
     -- ainda pode servir ao caminho legado da busca: fica fora da poda.
     where v.knowledge_source_id is not null
  ),
  vencidas as (
    select r.id
      from ranqueadas r
     where not r.is_active
       and coalesce(r.status, 'ready') <> 'building'
       and r.ordem > 2
       and r.created_at < now() - make_interval(days => v_dias)
       and not exists (
         select 1 from public.ai_knowledge_sources s where s.active_kb_version_id = r.id
       )
  ),
  alvo as (
    select c.id
      from public.ai_chunks c
      join vencidas x on x.id = c.kb_version_id
     limit v_limite
  )
  delete from public.ai_chunks c
   using alvo a
   where c.id = a.id;
  get diagnostics v_apagados = row_count;
  return v_apagados;
end;
$$;

revoke execute on function public.fn_expurgar_versoes_do_material(int, int) from public, anon, authenticated;
grant  execute on function public.fn_expurgar_versoes_do_material(int, int) to service_role;
