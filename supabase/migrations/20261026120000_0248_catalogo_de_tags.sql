-- 0248 — catálogo de tags e vínculo tag ↔ coluna do Kanban.
--
-- Até aqui uma tag era só texto solto em três `text[]` (`contacts.tags`,
-- `crm_leads.tags`, `conversations.tags`), sem lista, sem cor e sem tela: cada
-- superfície inferia as sugestões do uso, e "VIP", "vip" e "Vip " conviviam como
-- três tags. Quem opera não tinha onde CRIAR uma tag nem onde ver quais existem.
--
-- O que esta migration faz:
--
-- 1. `crm_tags` — o catálogo da organização (nome, cor, descrição, arquivada).
--    Os `text[]` CONTINUAM guardando o NOME, de propósito (DIRC: referenciar).
--    Fluxos, follow-up, disparo em massa, automações e ferramentas do agente leem
--    `text[]` com comparação EXATA (`regra-de-marcador.ts`); trocar para FK
--    reescreveria todos eles e quebraria regra já configurada com "VIP". O
--    catálogo é a fonte do nome, da cor e do vínculo; renomear passa por
--    `fn_renomear_tag`, que propaga para os três arrays.
--    Unicidade por NOME EXATO, não por `lower(name)`: clone com "VIP" e "vip"
--    nos dados ganha as duas linhas, que é a verdade do banco dele. Renomear uma
--    para o nome da outra as FUNDE. A tela recusa criar duplicata por caixa.
--
-- 2. `crm_stage_tags` — qual tag põe o contato em qual coluna. Uma tag cai em no
--    máximo UMA coluna por Kanban (`unique (pipeline_id, tag_id)`); a FK composta
--    `(pipeline_id, stage_id)` impede vincular coluna de outro Kanban.
--
-- 3. `fn_registra_tag_no_catalogo` — trigger em `contacts`/`crm_leads`: todo
--    nome que entra num `tags` por QUALQUER caminho (fluxo, agente, CSV, API)
--    nasce no catálogo, com cor derivada do nome. Sem isso a página de Tags
--    mostraria uma lista menor que a realidade. Só INSERT local, sem HTTP, sem
--    `event_log`. `security definer` porque a escrita no catálogo é manager+ pela
--    RLS e quem grava tag num contato pode ser `agent`.
--
-- 4. Backfill genérico (qualquer clone): todo nome já usado nos três arrays, no
--    vocabulário de conversa (`organizations.settings.canonical_conversation_tags`)
--    e no `canonical_tags` dos Kanbans entra no catálogo. As tags de CONVERSA são
--    copiadas para o CONTATO dono da conversa (decisão do produto em 2026-10-26:
--    a tag passa a ser do contato) — SÓ na primeira aplicação, guardada por
--    `to_regclass('public.crm_tags') is null`: no `update.sh` seguinte, uma tag
--    que alguém tirou do contato não pode voltar sozinha.
--
-- Idempotente: `if not exists`, `on conflict do nothing`, policies drop+create.

do $$
declare
  primeira boolean := to_regclass('public.crm_tags') is null;
begin
  create table if not exists public.crm_tags (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    name text not null,
    color text not null default '#64748b',
    description text,
    is_archived boolean not null default false,
    created_by_user_id uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint crm_tags_nome_valido
      check (char_length(btrim(name)) between 1 and 40 and name = btrim(name)),
    constraint crm_tags_cor_valida check (color ~ '^#[0-9a-f]{6}$'),
    constraint crm_tags_descricao_curta
      check (description is null or char_length(description) <= 280)
  );

  -- Backfill conversa → contato, SÓ na primeira aplicação (ver cabeçalho). Roda
  -- aqui, no mesmo bloco que cria a tabela, para não depender de estado entre
  -- comandos: o `install.sh` aplica em autocommit e o `migrate` numa transação.
  -- Os nomes copiados entram no catálogo pelo backfill (b), logo abaixo.
  if primeira then
    with da_conversa as (
      select cv.contact_id, array_agg(distinct btrim(t)) as tags
        from public.conversations cv
        cross join lateral unnest(cv.tags) as t
       where cv.contact_id is not null
         and char_length(btrim(t)) between 1 and 40
       group by cv.contact_id
    )
    update public.contacts c
       set tags = c.tags || array(
             select x from unnest(d.tags) x where not (x = any (c.tags)) order by x)
      from da_conversa d
     where c.id = d.contact_id
       and not (c.tags @> d.tags);
  end if;
end $$;

create unique index if not exists crm_tags_org_nome_key
  on public.crm_tags (organization_id, name);
create unique index if not exists crm_tags_org_id_key
  on public.crm_tags (organization_id, id);
create index if not exists crm_tags_org_ativas_idx
  on public.crm_tags (organization_id, name)
  where not is_archived;

comment on table public.crm_tags is
  'Catálogo de tags da organização (nome, cor, descrição). Os arrays contacts.tags, crm_leads.tags e conversations.tags guardam o NOME (comparação exata); renomear passa por fn_renomear_tag, que propaga. Nome desconhecido gravado num array nasce aqui pelo trigger fn_registra_tag_no_catalogo. Arquivar esconde do seletor sem tirar dos contatos.';

-- O vínculo coluna ↔ tag usa FK composta (pipeline_id, stage_id): precisa da
-- chave única correspondente em crm_stages.
create unique index if not exists crm_stages_pipeline_id_id_key
  on public.crm_stages (pipeline_id, id);

create table if not exists public.crm_stage_tags (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  pipeline_id uuid not null references public.crm_pipelines(id) on delete cascade,
  stage_id uuid not null,
  tag_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (stage_id, tag_id),
  constraint crm_stage_tags_coluna_do_kanban_fk foreign key (pipeline_id, stage_id)
    references public.crm_stages (pipeline_id, id) on delete cascade,
  constraint crm_stage_tags_tag_da_org_fk foreign key (organization_id, tag_id)
    references public.crm_tags (organization_id, id) on delete cascade
);

-- Uma tag cai em no máximo UMA coluna por Kanban: com duas, aplicar a tag não
-- saberia para qual mover.
create unique index if not exists crm_stage_tags_uma_coluna_por_kanban_key
  on public.crm_stage_tags (pipeline_id, tag_id);
create index if not exists crm_stage_tags_org_tag_idx
  on public.crm_stage_tags (organization_id, tag_id);

comment on table public.crm_stage_tags is
  'Tag vinculada a uma coluna do Kanban. Aplicar a tag no contato põe/move o lead dele nesta coluna; mover o lead para a coluna aplica a tag no contato (lib/tags/tag-no-kanban.ts). Nunca remove tag sozinho.';

-- ── cor padrão derivada do nome ─────────────────────────────────────────────
create or replace function public.fn_cor_da_tag(p_nome text)
returns text
language sql
immutable
set search_path = public
as $fn$
  select (array['#2563eb','#16a34a','#d97706','#dc2626','#7c3aed',
                '#0891b2','#db2777','#65a30d','#ea580c','#4f46e5'])
         [1 + (abs(hashtext(coalesce(p_nome, ''))::bigint) % 10)::int];
$fn$;

revoke execute on function public.fn_cor_da_tag(text) from public, anon;
grant  execute on function public.fn_cor_da_tag(text) to authenticated, service_role;

-- ── trigger: nome novo num array nasce no catálogo ──────────────────────────
create or replace function public.fn_registra_tag_no_catalogo()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.tags is null or cardinality(new.tags) = 0 then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.tags is not distinct from old.tags then
    return new;
  end if;

  insert into public.crm_tags (organization_id, name, color)
  select distinct new.organization_id, btrim(t), public.fn_cor_da_tag(btrim(t))
    from unnest(new.tags) as t
   where char_length(btrim(t)) between 1 and 40
  on conflict (organization_id, name) do nothing;

  return new;
end
$fn$;

revoke execute on function public.fn_registra_tag_no_catalogo() from public, anon, authenticated;
grant  execute on function public.fn_registra_tag_no_catalogo() to service_role;

drop trigger if exists trg_contacts_registra_tag_no_catalogo on public.contacts;
create trigger trg_contacts_registra_tag_no_catalogo
  after insert or update of tags on public.contacts
  for each row execute function public.fn_registra_tag_no_catalogo();

drop trigger if exists trg_crm_leads_registra_tag_no_catalogo on public.crm_leads;
create trigger trg_crm_leads_registra_tag_no_catalogo
  after insert or update of tags on public.crm_leads
  for each row execute function public.fn_registra_tag_no_catalogo();

drop trigger if exists trg_crm_tags_updated_at on public.crm_tags;
create trigger trg_crm_tags_updated_at
  before update on public.crm_tags
  for each row execute function public.fn_set_updated_at();

-- ── renomear (e fundir) ─────────────────────────────────────────────────────
-- Sem seletor livre: a organização vem do chamador (rota com service role e org
-- resolvida da sessão), e a tag precisa ser dela. Renomear para um nome que já
-- existe FUNDE as duas: os arrays trocam o nome e deduplicam, os vínculos de
-- coluna migram (quando não colidem) e a linha antiga sai.
create or replace function public.fn_renomear_tag(
  p_organization_id uuid,
  p_tag_id uuid,
  p_novo_nome text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_antigo text;
  v_novo text := btrim(coalesce(p_novo_nome, ''));
  v_destino uuid;
begin
  if char_length(v_novo) not between 1 and 40 then
    raise exception 'nome de tag inválido' using errcode = '22023';
  end if;

  select name into v_antigo
    from public.crm_tags
   where id = p_tag_id and organization_id = p_organization_id
   for update;
  if v_antigo is null then
    raise exception 'tag não encontrada' using errcode = 'P0002';
  end if;
  if v_antigo = v_novo then
    return p_tag_id;
  end if;

  select id into v_destino
    from public.crm_tags
   where organization_id = p_organization_id and name = v_novo;

  if v_destino is null then
    update public.crm_tags set name = v_novo where id = p_tag_id;
    v_destino := p_tag_id;
  end if;

  update public.contacts
     set tags = array(
           select x from unnest(array_replace(tags, v_antigo, v_novo)) with ordinality u(x, i)
            group by x order by min(i))
   where organization_id = p_organization_id and tags @> array[v_antigo];

  update public.crm_leads
     set tags = array(
           select x from unnest(array_replace(tags, v_antigo, v_novo)) with ordinality u(x, i)
            group by x order by min(i))
   where organization_id = p_organization_id and tags @> array[v_antigo];

  update public.conversations
     set tags = array(
           select x from unnest(array_replace(tags, v_antigo, v_novo)) with ordinality u(x, i)
            group by x order by min(i))
   where organization_id = p_organization_id and tags @> array[v_antigo];

  if v_destino <> p_tag_id then
    insert into public.crm_stage_tags (organization_id, pipeline_id, stage_id, tag_id)
    select organization_id, pipeline_id, stage_id, v_destino
      from public.crm_stage_tags
     where tag_id = p_tag_id
    on conflict do nothing;
    delete from public.crm_tags where id = p_tag_id;
  end if;

  return v_destino;
end
$fn$;

revoke execute on function public.fn_renomear_tag(uuid, uuid, text) from public, anon, authenticated;
grant  execute on function public.fn_renomear_tag(uuid, uuid, text) to service_role;

-- ── RLS: ler é de quem é da organização; escrever é manager+ ────────────────
alter table public.crm_tags enable row level security;
drop policy if exists tenant_isolation_crm_tags_all on public.crm_tags;
drop policy if exists crm_tags_select on public.crm_tags;
create policy crm_tags_select on public.crm_tags
  for select using (
    (organization_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin()
  );
drop policy if exists crm_tags_write on public.crm_tags;
create policy crm_tags_write on public.crm_tags
  using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );
revoke all on public.crm_tags from anon;

alter table public.crm_stage_tags enable row level security;
drop policy if exists tenant_isolation_crm_stage_tags_all on public.crm_stage_tags;
drop policy if exists crm_stage_tags_select on public.crm_stage_tags;
create policy crm_stage_tags_select on public.crm_stage_tags
  for select using (
    (organization_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin()
  );
drop policy if exists crm_stage_tags_write on public.crm_stage_tags;
create policy crm_stage_tags_write on public.crm_stage_tags
  using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );
revoke all on public.crm_stage_tags from anon;

-- ── backfill ────────────────────────────────────────────────────────────────
-- (a) conversa → contato: no primeiro bloco, junto da criação da tabela.
-- (b) todo nome em uso vira linha do catálogo. Idempotente: roda em todo update.
insert into public.crm_tags (organization_id, name, color)
select distinct organization_id, nome, public.fn_cor_da_tag(nome)
  from (
    select organization_id, btrim(t) as nome
      from public.contacts, unnest(tags) as t
    union
    select organization_id, btrim(t)
      from public.crm_leads, unnest(tags) as t
    union
    select organization_id, btrim(t)
      from public.conversations, unnest(tags) as t
    union
    select o.id, btrim(t)
      from public.organizations o,
           jsonb_array_elements_text(
             case when jsonb_typeof(o.settings -> 'canonical_conversation_tags') = 'array'
                  then o.settings -> 'canonical_conversation_tags' else '[]'::jsonb end) as t
    union
    select p.organization_id, btrim(t)
      from public.crm_pipelines p,
           jsonb_array_elements_text(
             case when jsonb_typeof(p.settings -> 'canonical_tags') = 'array'
                  then p.settings -> 'canonical_tags' else '[]'::jsonb end) as t
  ) nomes
 where char_length(nome) between 1 and 40
on conflict (organization_id, name) do nothing;

notify pgrst, 'reload schema';
