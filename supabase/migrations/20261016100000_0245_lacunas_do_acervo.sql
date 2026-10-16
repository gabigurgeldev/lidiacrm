-- ============================================================================
-- 0245 — LACUNAS DO ACERVO: O QUE O CLIENTE PERGUNTOU E O MATERIAL NÃO SABIA.
--
-- Desde a Onda 1 o agente não afirma fato da empresa sem fonte: chama a equipe
-- ou diz que não sabe. Isso acaba com a invenção, mas deixa a pergunta sem
-- resposta para sempre — o próximo cliente que perguntar a mesma coisa cai no
-- mesmo buraco. Esta migration dá ao dono o caminho de volta:
--
--   1. `knowledge_gaps` — uma linha por (organização, pergunta normalizada),
--      com contador de ocorrências e data da última. A pergunta guardada já
--      passou por anonimização (lib/ai/anonymize) no motor; a chave é a mesma
--      pergunta sem acento, sem caixa e sem palavras vazias, para "vocês têm
--      na cor azul?" e "Voces tem na cor azul" serem a MESMA lacuna.
--   2. `agent_inbox_items.kind = 'knowledge_gap'` — o aviso na Central, um por
--      lacuna aberta (ref_kind 'knowledge_gap', ref_id = a linha acima).
--   3. `ai_knowledge_sources.todos_os_agentes` — material da organização que
--      TODO agente consulta, além dos que a versão publicada escolheu. É onde
--      entram as respostas que o dono ensina pela Central ("Respostas
--      ensinadas pela equipe"): a versão publicada é imutável, e exigir uma
--      republicação por resposta faria o ensino nunca chegar ao agente.
--
-- Escrita só pelo servidor (motor e rota, service role). Leitura: membro da
-- organização — a Central é lida por agent+.
--
-- Aditiva e idempotente.
-- ============================================================================

-- ---- material que todo agente consulta ----
alter table public.ai_knowledge_sources
  add column if not exists todos_os_agentes boolean not null default false;

comment on column public.ai_knowledge_sources.todos_os_agentes is
  'true = todo agente da organização consulta este material, além dos escolhidos na versão publicada. Usado pelas respostas ensinadas na Central de lacunas.';

create index if not exists ai_knowledge_sources_todos_os_agentes_idx
  on public.ai_knowledge_sources (organization_id)
  where todos_os_agentes;

-- ---- lacunas ----
create table if not exists public.knowledge_gaps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Pergunta normalizada (sem acento, minúsculas, sem palavras vazias). Chave de dedupe.
  chave text not null,
  -- Um exemplo da pergunta, JÁ anonimizado. Nunca texto cru do cliente.
  pergunta text not null,
  ocorrencias integer not null default 1,
  primeira_em timestamptz not null default now(),
  ultima_em timestamptz not null default now(),
  status text not null default 'aberta',
  -- O par pergunta–resposta que o dono escreveu ao ensinar.
  faq_item_id uuid references public.ai_faq_items(id) on delete set null,
  respondida_por uuid references auth.users(id) on delete set null,
  respondida_em timestamptz,
  created_at timestamptz not null default now()
);

alter table public.knowledge_gaps drop constraint if exists knowledge_gaps_status_check;
alter table public.knowledge_gaps add constraint knowledge_gaps_status_check
  check (status in ('aberta', 'respondida', 'descartada'));

create unique index if not exists knowledge_gaps_org_chave_uidx
  on public.knowledge_gaps (organization_id, chave);
create index if not exists knowledge_gaps_org_abertas_idx
  on public.knowledge_gaps (organization_id, ultima_em desc)
  where status = 'aberta';

alter table public.knowledge_gaps enable row level security;

drop policy if exists tenant_isolation_knowledge_gaps_all on public.knowledge_gaps;
create policy tenant_isolation_knowledge_gaps_all on public.knowledge_gaps
  for select using (
    organization_id in (select public.fn_user_org_ids())
    or public.fn_is_platform_admin()
  );
revoke insert, update, delete, truncate on public.knowledge_gaps from anon, authenticated;
revoke all on public.knowledge_gaps from anon;

-- ---- a Central aprende knowledge_gap ----
-- Bloco ÚNICO da constraint (issue #159): reconstrói a lista inteira, igual ao
-- bloco único do baseline.
alter table public.agent_inbox_items
  drop constraint if exists agent_inbox_items_kind_check;

alter table public.agent_inbox_items
  add constraint agent_inbox_items_kind_check check (kind in (
    'qr_rescan',
    'job_dead',
    'event_dead',
    'budget_exceeded',
    'handoff',
    'promotion_review',
    'judge_unaligned',
    'followup_dead',
    'snooze_expired',
    'next_action_ambiguous',
    'risk_backlog_seeded',
    'reactivation_expired',
    'capabilities_missing',
    'message_send_stuck',
    'midia_nao_lida',
    'channel_template_review',
    'channel_number_alert',
    'promise_unfulfilled',
    'contact_proposal_expired',
    'budget_warning',
    'conhecimento_nao_indexado',
    'disparo_travado',
    'voz_indisponivel',
    'integracao_api_falhando',
    'acao_externa_falhou',
    'verificacao_bloqueada',
    'coordenador_preso',
    'turno_sem_resposta',
    'escolha_nao_lida',
    'knowledge_gap',
    'other'
  ));

notify pgrst, 'reload schema';
