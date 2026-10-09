-- ============================================================================
-- 0229 — COORDENADOR DE ATENDIMENTO: QUEM CONDUZ A CONVERSA, NUM LUGAR SÓ.
--
-- Até aqui "quem conduz" era deduzido de seis lugares que cada caminho lia a
-- seu modo (contacts.force_human, conversations.bot_silenced_until /
-- assignee_kind / active_ai_agent_id, flow_executions.silencia_ia,
-- settings.ai_dispatch_mode), e cada mensagem do cliente tinha até cinco
-- consumidores sem árbitro (gatilhos de fluxo, frentes esperando, follow-up,
-- automações, turno do agente). Ver docs/adr/0002-coordenador-de-atendimento.md.
--
-- Esta migration cria só o NÚCLEO PERSISTIDO, e ele nasce DESLIGADO: sem
-- política publicada, nenhum consumidor muda de comportamento.
--
--   coord_politica_versoes / _ponteiros / _destinos — a política da org (e, se
--     houver, de um número), versionada e imutável; destino é FK, nunca id solto.
--   coord_estado_conversa — o responsável atual, com `versao` (CAS) e `geracao`
--     (fencing: executor com geração velha não fala nem transiciona).
--   coord_chamadas — chamada com retorno e transferência definitiva.
--   coord_admissoes — uma mensagem do cliente responde no MÁXIMO uma pergunta.
--   coord_transicoes — o diário (append-only, sem texto do cliente).
--
-- Funções:
--   fn_coord_transicionar — a ÚNICA porta de mudança de responsável. CAS na
--     versão, geração+1, diário e o evento de despacho (outbox) na MESMA
--     transação: não existe troca aceita com destino perdido entre gravações.
--   fn_coord_admitir — idempotente por (org, message_id).
--   fn_coord_pode_falar — o ponto de linearização do envio automático.
--   fn_coord_publicar_politica — número + versão + destinos + ponteiro, atômico.
--   triggers de prioridade humana — conversa assumida/pausada, contato travado
--     ou bloqueado: o estado vira `pessoa`/`bloqueado` e a geração sobe, por
--     QUALQUER caminho que já existe (rota, MCP, handoff do agente, SQL). Sem
--     caçar chamador por chamador. Só atualizam linha — trigger NUNCA faz HTTP.
--
-- Escrita só por service_role (o worker e as rotas com o client admin, que
-- filtram organization_id); `authenticated` só LÊ, pela RLS.
--
-- Aditiva e idempotente. Contas sem política não ganham linha nenhuma.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Política versionada
-- ---------------------------------------------------------------------------

create table if not exists public.coord_politica_versoes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- null = padrão da organização; preenchido = vale só para aquele número.
  channel_session_id uuid references public.channel_sessions(id) on delete cascade,
  numero int not null check (numero > 0),
  modo text not null check (modo in ('off', 'shadow', 'active')),
  -- Validado por lib/coordenador/politica/schema.ts (o MESMO Zod da tela).
  config jsonb not null default '{}'::jsonb,
  publicado_por uuid,
  publicado_em timestamptz not null default now()
);

create unique index if not exists uniq_coord_politica_versoes_numero
  on public.coord_politica_versoes (
    organization_id,
    coalesce(channel_session_id, '00000000-0000-0000-0000-000000000000'::uuid),
    numero
  );

drop trigger if exists trg_coord_politica_versoes_imutavel on public.coord_politica_versoes;
create trigger trg_coord_politica_versoes_imutavel
  before update on public.coord_politica_versoes
  for each row execute function public.fn_agent_versions_immutable();

create table if not exists public.coord_politica_destinos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  versao_id uuid not null references public.coord_politica_versoes(id) on delete cascade,
  -- Chave curta que o agente e o decisor enxergam; o servidor resolve para o id.
  chave text not null check (chave ~ '^[a-z0-9_]{1,40}$'),
  tipo text not null check (tipo in ('agente', 'fluxo')),
  agent_id uuid references public.ai_agents(id) on delete cascade,
  flow_id uuid references public.flows(id) on delete cascade,
  quando_usar text not null default '',
  exemplos text[] not null default '{}',
  nao_usar text[] not null default '{}',
  prioridade int not null default 0,
  -- Pode conduzir a conversa (falar com o cliente) e/ou ser chamado como tarefa.
  permite_conduzir boolean not null default true,
  permite_tarefa boolean not null default false,
  constraint coord_politica_destinos_um_alvo check (
    (tipo = 'agente' and agent_id is not null and flow_id is null)
    or (tipo = 'fluxo' and flow_id is not null and agent_id is null)
  ),
  unique (versao_id, chave)
);

create index if not exists idx_coord_politica_destinos_versao
  on public.coord_politica_destinos (versao_id);

drop trigger if exists trg_coord_politica_destinos_imutavel on public.coord_politica_destinos;
create trigger trg_coord_politica_destinos_imutavel
  before update on public.coord_politica_destinos
  for each row execute function public.fn_agent_versions_immutable();

create table if not exists public.coord_politica_ponteiros (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel_session_id uuid references public.channel_sessions(id) on delete cascade,
  versao_id uuid not null references public.coord_politica_versoes(id),
  atualizado_por uuid,
  updated_at timestamptz not null default now()
);

create unique index if not exists uniq_coord_politica_ponteiro_org
  on public.coord_politica_ponteiros (organization_id)
  where channel_session_id is null;
create unique index if not exists uniq_coord_politica_ponteiro_canal
  on public.coord_politica_ponteiros (organization_id, channel_session_id)
  where channel_session_id is not null;

-- ---------------------------------------------------------------------------
-- Estado da conversa
-- ---------------------------------------------------------------------------

create table if not exists public.coord_estado_conversa (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  channel_session_id uuid,
  politica_versao_id uuid references public.coord_politica_versoes(id) on delete set null,
  dono_tipo text not null default 'nenhum'
    check (dono_tipo in ('nenhum', 'agente', 'fluxo', 'pessoa')),
  dono_agent_id uuid references public.ai_agents(id) on delete set null,
  dono_agent_version_id uuid references public.ai_agent_versions(id) on delete set null,
  dono_execution_id uuid references public.flow_executions(id) on delete set null,
  dono_frame_id uuid,
  situacao text not null default 'ativo'
    check (situacao in ('ativo', 'esperando_cliente', 'esperando_tarefa', 'pausado', 'concluido', 'bloqueado')),
  -- CAS: toda transição exige a versão lida; duas decisões concorrentes não
  -- se sobrepõem — a segunda vê `conflito` e é descartada.
  versao bigint not null default 0,
  -- Fencing: sobe a cada troca de responsável. Executor que carrega geração
  -- velha não envia nem transiciona (fn_coord_pode_falar).
  geracao bigint not null default 0,
  pergunta_id text,
  pergunta_aberta_em timestamptz,
  pergunta_formato text,
  pergunta_frame_id uuid,
  ultima_admitida_message_id uuid,
  ultima_admitida_em timestamptz,
  motivo text,
  prazo timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, conversation_id)
);

create unique index if not exists uniq_coord_estado_conversa
  on public.coord_estado_conversa (conversation_id);
create index if not exists idx_coord_estado_contato
  on public.coord_estado_conversa (organization_id, contact_id);
create index if not exists idx_coord_estado_prazo
  on public.coord_estado_conversa (prazo)
  where prazo is not null;

-- ---------------------------------------------------------------------------
-- Chamadas (com retorno) e transferências
-- ---------------------------------------------------------------------------

create table if not exists public.coord_chamadas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  parent_chamada_id uuid references public.coord_chamadas(id) on delete set null,
  modalidade text not null check (modalidade in ('retorno', 'definitiva')),
  -- conduzir: o destino fala com o cliente; tarefa: trabalha sem falar.
  modo_destino text not null default 'conduzir' check (modo_destino in ('conduzir', 'tarefa')),
  origem_tipo text not null check (origem_tipo in ('agente', 'fluxo', 'sistema', 'pessoa')),
  origem_agent_id uuid references public.ai_agents(id) on delete set null,
  origem_agent_version_id uuid references public.ai_agent_versions(id) on delete set null,
  origem_execution_id uuid references public.flow_executions(id) on delete set null,
  origem_frame_id uuid,
  origem_node_id text,
  destino_tipo text not null check (destino_tipo in ('agente', 'fluxo')),
  destino_agent_id uuid references public.ai_agents(id) on delete set null,
  destino_flow_id uuid references public.flows(id) on delete set null,
  destino_execution_id uuid references public.flow_executions(id) on delete set null,
  status text not null default 'pendente'
    check (status in ('pendente', 'ativa', 'concluida', 'cancelada', 'falhou', 'expirou')),
  objetivo text,
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  output_esperado jsonb,
  prazo timestamptz not null,
  geracao_origem bigint not null,
  profundidade int not null default 1 check (profundidade between 1 and 10),
  chave_idempotencia text not null,
  motivo_fim text,
  concluida_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, chave_idempotencia)
);

create index if not exists idx_coord_chamadas_abertas
  on public.coord_chamadas (organization_id, conversation_id)
  where status in ('pendente', 'ativa');
create index if not exists idx_coord_chamadas_prazo
  on public.coord_chamadas (prazo)
  where status in ('pendente', 'ativa');
create index if not exists idx_coord_chamadas_execucao_destino
  on public.coord_chamadas (destino_execution_id)
  where destino_execution_id is not null;

-- ---------------------------------------------------------------------------
-- Admissão de mensagens e diário de transições
-- ---------------------------------------------------------------------------

create table if not exists public.coord_admissoes (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  consumidor_tipo text not null check (consumidor_tipo in ('agente', 'fluxo', 'followup', 'nenhum')),
  consumidor_id uuid,
  pergunta_id text,
  geracao bigint not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, message_id)
);

create index if not exists idx_coord_admissoes_conversa
  on public.coord_admissoes (organization_id, conversation_id, created_at desc);

create table if not exists public.coord_transicoes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  de_tipo text,
  de_id uuid,
  para_tipo text,
  para_id uuid,
  categoria text not null
    check (categoria in ('regra', 'continuidade', 'modelo', 'manual', 'retorno', 'recuperacao', 'fallback')),
  -- Código fechado e legível (lib/coordenador/telemetria.ts), nunca texto livre do modelo.
  motivo text not null,
  status text not null check (status in ('aplicada', 'recusada', 'obsoleta', 'falhou', 'shadow')),
  politica_versao_id uuid,
  versao bigint,
  geracao bigint,
  message_id uuid,
  chamada_id uuid,
  decisor_provedor text,
  decisor_modelo text,
  decisor_ms int,
  -- null = custo DESCONHECIDO, nunca zero inventado.
  decisor_custo_cents numeric,
  decisor_confianca numeric(4, 3),
  detalhe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_coord_transicoes_conversa
  on public.coord_transicoes (organization_id, conversation_id, created_at desc);
create index if not exists idx_coord_transicoes_org
  on public.coord_transicoes (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Integridade entre organizações
-- ---------------------------------------------------------------------------
-- Uma FK prova que o alvo EXISTE, não que é da mesma organização. Sem isto, um
-- id de agente de outra org (vindo de um bug ou de um corpo forjado que passou
-- pelo service role) entraria como destino e o despacho executaria na org
-- errada. O trigger confere cada referência contra a org da própria linha.

create or replace function public.fn_coord_mesma_org() returns trigger
  language plpgsql security definer
  set search_path to 'public', 'pg_temp'
as $$
declare
  v_ref uuid;
  v_tabela text;
  v_coluna text;
  v_org uuid;
  v_par text[];
  v_pares text[][] := array[
    array['agent_id', 'ai_agents'],
    array['flow_id', 'flows'],
    array['dono_agent_id', 'ai_agents'],
    array['dono_execution_id', 'flow_executions'],
    array['origem_agent_id', 'ai_agents'],
    array['origem_execution_id', 'flow_executions'],
    array['destino_agent_id', 'ai_agents'],
    array['destino_flow_id', 'flows'],
    array['destino_execution_id', 'flow_executions'],
    array['conversation_id', 'conversations'],
    array['message_id', 'messages'],
    array['versao_id', 'coord_politica_versoes'],
    array['channel_session_id', 'channel_sessions']
  ];
  v_novo jsonb := to_jsonb(new);
begin
  foreach v_par slice 1 in array v_pares loop
    v_coluna := v_par[1];
    v_tabela := v_par[2];
    if not (v_novo ? v_coluna) then
      continue;
    end if;
    v_ref := nullif(v_novo ->> v_coluna, '')::uuid;
    if v_ref is null then
      continue;
    end if;
    execute format('select organization_id from public.%I where id = $1', v_tabela)
      into v_org using v_ref;
    if v_org is distinct from new.organization_id then
      raise exception 'coord_referencia_de_outra_organizacao'
        using detail = format('%s.%s aponta para outra organização', tg_table_name, v_coluna);
    end if;
  end loop;
  return new;
end $$;

revoke execute on function public.fn_coord_mesma_org() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'coord_politica_versoes', 'coord_politica_destinos', 'coord_politica_ponteiros',
    'coord_estado_conversa', 'coord_chamadas', 'coord_admissoes'
  ] loop
    execute format('drop trigger if exists trg_%s_mesma_org on public.%I', t, t);
    execute format(
      'create trigger trg_%s_mesma_org before insert or update on public.%I
         for each row execute function public.fn_coord_mesma_org()',
      t, t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- RLS e privilégios: o cliente LÊ (pela RLS); só o service role escreve.
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'coord_politica_versoes', 'coord_politica_destinos', 'coord_politica_ponteiros',
    'coord_estado_conversa', 'coord_chamadas', 'coord_admissoes', 'coord_transicoes'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    -- Policy só de LEITURA: a escrita é do service role (que ignora RLS), e uma
    -- policy `for all` só-tenancy é exatamente a dívida que
    -- rbac-config-ia-canais.test.ts proíbe em tabela nova.
    execute format('drop policy if exists tenant_isolation_%s_all on public.%I', t, t);
    execute format('drop policy if exists coord_leitura_%s on public.%I', t, t);
    execute format(
      'create policy coord_leitura_%s on public.%I for select
         using (organization_id in (select * from public.fn_user_org_ids()))',
      t, t
    );
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- fn_coord_transicionar — a única porta de mudança de responsável
-- ---------------------------------------------------------------------------
-- Lê-decide-revalida acontece FORA desta função (o decisor pode levar segundos
-- e nenhuma transação fica aberta esperando rede). Aqui só o "aplica": lock
-- curto de linha, CAS na versão, regras que não podem ser violadas, diário e
-- outbox — tudo ou nada.

create or replace function public.fn_coord_transicionar(
  p_org uuid,
  p_conversa uuid,
  p_versao_esperada bigint,
  p_dono_tipo text,
  p_dono_agent_id uuid,
  p_dono_agent_version_id uuid,
  p_dono_execution_id uuid,
  p_dono_frame_id uuid,
  p_situacao text,
  p_categoria text,
  p_motivo text,
  p_politica_versao_id uuid,
  p_message_id uuid,
  p_chamada_id uuid,
  p_despacho jsonb,
  p_detalhe jsonb
) returns jsonb
  language plpgsql
  set search_path to 'public', 'pg_temp'
as $$
declare
  v_estado public.coord_estado_conversa%rowtype;
  v_conversa record;
  v_evento uuid;
  v_de_tipo text;
  v_de_id uuid;
begin
  select id, organization_id, contact_id, channel_session_id
    into v_conversa
    from public.conversations
   where id = p_conversa and organization_id = p_org;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'conversa_inexistente');
  end if;

  insert into public.coord_estado_conversa
    (organization_id, conversation_id, contact_id, channel_session_id)
  values (p_org, p_conversa, v_conversa.contact_id, v_conversa.channel_session_id)
  on conflict (organization_id, conversation_id) do nothing;

  select * into v_estado
    from public.coord_estado_conversa
   where organization_id = p_org and conversation_id = p_conversa
   for update;

  if v_estado.versao <> p_versao_esperada then
    insert into public.coord_transicoes
      (organization_id, conversation_id, de_tipo, de_id, para_tipo, para_id,
       categoria, motivo, status, politica_versao_id, versao, geracao, message_id, chamada_id, detalhe)
    values
      (p_org, p_conversa, v_estado.dono_tipo,
       coalesce(v_estado.dono_agent_id, v_estado.dono_execution_id),
       p_dono_tipo, coalesce(p_dono_agent_id, p_dono_execution_id),
       p_categoria, p_motivo, 'obsoleta', p_politica_versao_id,
       v_estado.versao, v_estado.geracao, p_message_id, p_chamada_id,
       coalesce(p_detalhe, '{}'::jsonb) || jsonb_build_object('versao_esperada', p_versao_esperada));
    return jsonb_build_object('ok', false, 'motivo', 'conflito',
                              'versao', v_estado.versao, 'geracao', v_estado.geracao);
  end if;

  -- Prioridade humana: só uma ação MANUAL tira a conversa de uma pessoa. Nem
  -- regra, nem modelo, nem retorno de tarefa atrasado.
  if v_estado.dono_tipo = 'pessoa' and p_categoria <> 'manual' then
    insert into public.coord_transicoes
      (organization_id, conversation_id, de_tipo, para_tipo, para_id,
       categoria, motivo, status, politica_versao_id, versao, geracao, message_id, chamada_id, detalhe)
    values
      (p_org, p_conversa, 'pessoa', p_dono_tipo, coalesce(p_dono_agent_id, p_dono_execution_id),
       p_categoria, 'prioridade_humana', 'recusada', p_politica_versao_id,
       v_estado.versao, v_estado.geracao, p_message_id, p_chamada_id, coalesce(p_detalhe, '{}'::jsonb));
    return jsonb_build_object('ok', false, 'motivo', 'prioridade_humana',
                              'versao', v_estado.versao, 'geracao', v_estado.geracao);
  end if;

  if p_dono_tipo = 'agente' and p_dono_agent_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'destino_invalido');
  end if;
  if p_dono_tipo = 'fluxo' and p_dono_execution_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'destino_invalido');
  end if;

  v_de_tipo := v_estado.dono_tipo;
  v_de_id := coalesce(v_estado.dono_agent_id, v_estado.dono_execution_id);

  update public.coord_estado_conversa
     set dono_tipo = p_dono_tipo,
         dono_agent_id = case when p_dono_tipo = 'agente' then p_dono_agent_id end,
         dono_agent_version_id = case when p_dono_tipo = 'agente' then p_dono_agent_version_id end,
         dono_execution_id = case when p_dono_tipo = 'fluxo' then p_dono_execution_id end,
         dono_frame_id = case when p_dono_tipo = 'fluxo' then p_dono_frame_id end,
         situacao = coalesce(p_situacao, 'ativo'),
         politica_versao_id = coalesce(p_politica_versao_id, politica_versao_id),
         versao = versao + 1,
         geracao = geracao + 1,
         -- A pergunta aberta pertencia ao dono anterior: uma resposta futura
         -- não pode cair nela.
         pergunta_id = null,
         pergunta_aberta_em = null,
         pergunta_formato = null,
         pergunta_frame_id = null,
         motivo = p_motivo,
         updated_at = now()
   where organization_id = p_org and conversation_id = p_conversa
   returning * into v_estado;

  -- O que o decisor custou e disse vem em `p_detalhe->'decisor'` (quando houve
  -- modelo) e vai para as colunas próprias: custo ausente fica NULL
  -- (desconhecido), nunca zero.
  insert into public.coord_transicoes
    (organization_id, conversation_id, de_tipo, de_id, para_tipo, para_id,
     categoria, motivo, status, politica_versao_id, versao, geracao, message_id, chamada_id,
     decisor_provedor, decisor_modelo, decisor_ms, decisor_custo_cents, decisor_confianca, detalhe)
  values
    (p_org, p_conversa, v_de_tipo, v_de_id, p_dono_tipo, coalesce(p_dono_agent_id, p_dono_execution_id),
     p_categoria, p_motivo, 'aplicada', p_politica_versao_id,
     v_estado.versao, v_estado.geracao, p_message_id, p_chamada_id,
     p_detalhe -> 'decisor' ->> 'provedor',
     p_detalhe -> 'decisor' ->> 'modelo',
     nullif(p_detalhe -> 'decisor' ->> 'ms', '')::int,
     nullif(p_detalhe -> 'decisor' ->> 'custo_cents', '')::numeric,
     nullif(p_detalhe -> 'decisor' ->> 'confianca', '')::numeric,
     coalesce(p_detalhe, '{}'::jsonb) - 'decisor');

  -- Outbox: a intenção de iniciar o próximo executor nasce na MESMA transação
  -- da troca. Um crash depois do commit deixa o evento para o drain; um crash
  -- antes não deixa troca nenhuma.
  if p_despacho is not null and p_despacho ? 'event_type' then
    insert into public.event_log
      (organization_id, event_type, entity_kind, entity_id, payload, metadata)
    values
      (p_org,
       p_despacho ->> 'event_type',
       coalesce(p_despacho ->> 'entity_kind', 'conversation'),
       coalesce(nullif(p_despacho ->> 'entity_id', '')::uuid, p_conversa),
       coalesce(p_despacho -> 'payload', '{}'::jsonb)
         || jsonb_build_object('coord_geracao', v_estado.geracao, 'coord_versao', v_estado.versao),
       jsonb_build_object('emitted_at', extract(epoch from now()), 'origem', 'coordenador'))
    returning id into v_evento;
  end if;

  return jsonb_build_object('ok', true, 'versao', v_estado.versao,
                            'geracao', v_estado.geracao, 'evento_id', v_evento);
end $$;

revoke execute on function public.fn_coord_transicionar(
  uuid, uuid, bigint, text, uuid, uuid, uuid, uuid, text, text, text, uuid, uuid, uuid, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.fn_coord_transicionar(
  uuid, uuid, bigint, text, uuid, uuid, uuid, uuid, text, text, text, uuid, uuid, uuid, jsonb, jsonb
) to service_role;

-- ---------------------------------------------------------------------------
-- fn_coord_admitir — uma mensagem, no máximo um consumidor
-- ---------------------------------------------------------------------------
-- Idempotente: reentrega do webhook, do evento ou do job devolve a admissão
-- ORIGINAL (`ja_admitida = true`), e quem chamou não aplica de novo.

create or replace function public.fn_coord_admitir(
  p_org uuid,
  p_message_id uuid,
  p_conversa uuid,
  p_consumidor_tipo text,
  p_consumidor_id uuid,
  p_pergunta_id text,
  p_geracao bigint
) returns jsonb
  language plpgsql
  set search_path to 'public', 'pg_temp'
as $$
declare
  v_linha public.coord_admissoes%rowtype;
  v_nova boolean := false;
begin
  insert into public.coord_admissoes
    (organization_id, message_id, conversation_id, consumidor_tipo, consumidor_id, pergunta_id, geracao)
  values
    (p_org, p_message_id, p_conversa, p_consumidor_tipo, p_consumidor_id, p_pergunta_id, p_geracao)
  on conflict (organization_id, message_id) do nothing
  returning * into v_linha;

  if found then
    v_nova := true;
    update public.coord_estado_conversa
       set ultima_admitida_message_id = p_message_id,
           ultima_admitida_em = now(),
           updated_at = now()
     where organization_id = p_org and conversation_id = p_conversa;
  else
    select * into v_linha
      from public.coord_admissoes
     where organization_id = p_org and message_id = p_message_id;
  end if;

  return jsonb_build_object(
    'ja_admitida', not v_nova,
    'consumidor_tipo', v_linha.consumidor_tipo,
    'consumidor_id', v_linha.consumidor_id,
    'pergunta_id', v_linha.pergunta_id,
    'geracao', v_linha.geracao
  );
end $$;

revoke execute on function public.fn_coord_admitir(uuid, uuid, uuid, text, uuid, text, bigint)
  from public, anon, authenticated;
grant execute on function public.fn_coord_admitir(uuid, uuid, uuid, text, uuid, text, bigint)
  to service_role;

-- ---------------------------------------------------------------------------
-- fn_coord_pode_falar — o ponto de linearização do envio automático
-- ---------------------------------------------------------------------------
-- Sem linha de estado = o coordenador não está conduzindo esta conversa, e o
-- caminho legado decide (comportamento anterior preservado). Com linha: só o
-- dono atual, na geração atual, fala; pessoa e bloqueio calam todo automático.

create or replace function public.fn_coord_pode_falar(
  p_org uuid,
  p_conversa uuid,
  p_executor_tipo text,
  p_executor_id uuid,
  p_geracao bigint
) returns jsonb
  language plpgsql stable
  set search_path to 'public', 'pg_temp'
as $$
declare
  v_estado public.coord_estado_conversa%rowtype;
begin
  select * into v_estado
    from public.coord_estado_conversa
   where organization_id = p_org and conversation_id = p_conversa;
  if not found then
    return jsonb_build_object('pode', true, 'motivo', 'sem_coordenacao');
  end if;
  if v_estado.situacao = 'bloqueado' then
    return jsonb_build_object('pode', false, 'motivo', 'bloqueado', 'geracao', v_estado.geracao);
  end if;
  if v_estado.dono_tipo = 'pessoa' then
    return jsonb_build_object('pode', false, 'motivo', 'pessoa_no_comando', 'geracao', v_estado.geracao);
  end if;
  if v_estado.dono_tipo = 'nenhum' then
    return jsonb_build_object('pode', false, 'motivo', 'sem_dono', 'geracao', v_estado.geracao);
  end if;
  if p_geracao is distinct from v_estado.geracao then
    return jsonb_build_object('pode', false, 'motivo', 'geracao_obsoleta', 'geracao', v_estado.geracao);
  end if;
  if (v_estado.dono_tipo = 'agente' and (p_executor_tipo <> 'agente' or p_executor_id is distinct from v_estado.dono_agent_id))
     or (v_estado.dono_tipo = 'fluxo' and (p_executor_tipo <> 'fluxo' or p_executor_id is distinct from v_estado.dono_execution_id)) then
    return jsonb_build_object('pode', false, 'motivo', 'nao_e_o_dono', 'geracao', v_estado.geracao);
  end if;
  return jsonb_build_object('pode', true, 'motivo', 'dono_atual', 'geracao', v_estado.geracao);
end $$;

revoke execute on function public.fn_coord_pode_falar(uuid, uuid, text, uuid, bigint)
  from public, anon, authenticated;
grant execute on function public.fn_coord_pode_falar(uuid, uuid, text, uuid, bigint)
  to service_role;

-- ---------------------------------------------------------------------------
-- fn_coord_publicar_politica — versão + destinos + ponteiro, atômico
-- ---------------------------------------------------------------------------
-- O número sai sob lock do ponteiro (não o select-max solto de
-- publicarMemoriaDaOrg, que o próprio código admite não ser atômico).

create or replace function public.fn_coord_publicar_politica(
  p_org uuid,
  p_canal uuid,
  p_modo text,
  p_config jsonb,
  p_destinos jsonb,
  p_autor uuid
) returns jsonb
  language plpgsql
  set search_path to 'public', 'pg_temp'
as $$
declare
  v_numero int;
  v_versao uuid;
  v_d jsonb;
begin
  -- Serializa publicações da mesma org/número.
  perform pg_advisory_xact_lock(
    hashtext('coord_politica:' || p_org::text || ':' || coalesce(p_canal::text, 'org'))
  );

  select coalesce(max(numero), 0) + 1 into v_numero
    from public.coord_politica_versoes
   where organization_id = p_org
     and channel_session_id is not distinct from p_canal;

  insert into public.coord_politica_versoes
    (organization_id, channel_session_id, numero, modo, config, publicado_por)
  values (p_org, p_canal, v_numero, p_modo, coalesce(p_config, '{}'::jsonb), p_autor)
  returning id into v_versao;

  for v_d in select * from jsonb_array_elements(coalesce(p_destinos, '[]'::jsonb)) loop
    insert into public.coord_politica_destinos
      (organization_id, versao_id, chave, tipo, agent_id, flow_id, quando_usar,
       exemplos, nao_usar, prioridade, permite_conduzir, permite_tarefa)
    values
      (p_org, v_versao, v_d ->> 'chave', v_d ->> 'tipo',
       nullif(v_d ->> 'agent_id', '')::uuid, nullif(v_d ->> 'flow_id', '')::uuid,
       coalesce(v_d ->> 'quando_usar', ''),
       coalesce(array(select jsonb_array_elements_text(v_d -> 'exemplos')), '{}'),
       coalesce(array(select jsonb_array_elements_text(v_d -> 'nao_usar')), '{}'),
       coalesce((v_d ->> 'prioridade')::int, 0),
       coalesce((v_d ->> 'permite_conduzir')::boolean, true),
       coalesce((v_d ->> 'permite_tarefa')::boolean, false));
  end loop;

  if p_canal is null then
    insert into public.coord_politica_ponteiros (organization_id, channel_session_id, versao_id, atualizado_por)
    values (p_org, null, v_versao, p_autor)
    on conflict (organization_id) where channel_session_id is null
    do update set versao_id = excluded.versao_id, atualizado_por = excluded.atualizado_por, updated_at = now();
  else
    insert into public.coord_politica_ponteiros (organization_id, channel_session_id, versao_id, atualizado_por)
    values (p_org, p_canal, v_versao, p_autor)
    on conflict (organization_id, channel_session_id) where channel_session_id is not null
    do update set versao_id = excluded.versao_id, atualizado_por = excluded.atualizado_por, updated_at = now();
  end if;

  return jsonb_build_object('ok', true, 'versao_id', v_versao, 'numero', v_numero);
end $$;

revoke execute on function public.fn_coord_publicar_politica(uuid, uuid, text, jsonb, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.fn_coord_publicar_politica(uuid, uuid, text, jsonb, jsonb, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- Prioridade humana por trigger
-- ---------------------------------------------------------------------------
-- Só mexe em conversa que JÁ tem estado de coordenação (o coordenador está
-- ativo nela); as demais seguem exatamente como antes.

create or replace function public.fn_coord_pessoa_assumiu() returns trigger
  language plpgsql security definer
  set search_path to 'public', 'pg_temp'
as $$
declare
  v_estado public.coord_estado_conversa%rowtype;
begin
  if not (
       (new.assignee_kind = 'user' and old.assignee_kind is distinct from 'user')
    or (new.bot_silenced_until = 'infinity'::timestamptz
        and old.bot_silenced_until is distinct from 'infinity'::timestamptz)
    or (new.status = 'claimed' and old.status is distinct from 'claimed')
  ) then
    return new;
  end if;

  update public.coord_estado_conversa
     set dono_tipo = 'pessoa',
         dono_agent_id = null, dono_agent_version_id = null,
         dono_execution_id = null, dono_frame_id = null,
         situacao = 'pausado',
         versao = versao + 1, geracao = geracao + 1,
         pergunta_id = null, pergunta_aberta_em = null,
         pergunta_formato = null, pergunta_frame_id = null,
         motivo = 'pessoa_assumiu', updated_at = now()
   where organization_id = new.organization_id
     and conversation_id = new.id
     and dono_tipo <> 'pessoa'
  returning * into v_estado;

  if found then
    insert into public.coord_transicoes
      (organization_id, conversation_id, para_tipo, categoria, motivo, status, versao, geracao)
    values
      (new.organization_id, new.id, 'pessoa', 'manual', 'pessoa_assumiu', 'aplicada',
       v_estado.versao, v_estado.geracao);
  end if;
  return new;
end $$;

revoke execute on function public.fn_coord_pessoa_assumiu() from public, anon, authenticated;

drop trigger if exists trg_coord_pessoa_assumiu on public.conversations;
create trigger trg_coord_pessoa_assumiu
  after update of assignee_kind, bot_silenced_until, status on public.conversations
  for each row execute function public.fn_coord_pessoa_assumiu();

create or replace function public.fn_coord_contato_travado() returns trigger
  language plpgsql security definer
  set search_path to 'public', 'pg_temp'
as $$
declare
  v_situacao text;
  v_motivo text;
  r record;
begin
  if new.is_blocked and not coalesce(old.is_blocked, false) then
    v_situacao := 'bloqueado';
    v_motivo := 'contato_bloqueado';
  elsif new.force_human and not coalesce(old.force_human, false) then
    v_situacao := 'pausado';
    v_motivo := 'contato_com_pessoa';
  else
    return new;
  end if;

  for r in
    update public.coord_estado_conversa
       set dono_tipo = 'pessoa',
           dono_agent_id = null, dono_agent_version_id = null,
           dono_execution_id = null, dono_frame_id = null,
           situacao = v_situacao,
           versao = versao + 1, geracao = geracao + 1,
           pergunta_id = null, pergunta_aberta_em = null,
           pergunta_formato = null, pergunta_frame_id = null,
           motivo = v_motivo, updated_at = now()
     where organization_id = new.organization_id
       and contact_id = new.id
       and (dono_tipo <> 'pessoa' or situacao <> v_situacao)
    returning conversation_id, versao, geracao
  loop
    insert into public.coord_transicoes
      (organization_id, conversation_id, para_tipo, categoria, motivo, status, versao, geracao)
    values
      (new.organization_id, r.conversation_id, 'pessoa', 'manual', v_motivo, 'aplicada', r.versao, r.geracao);
  end loop;
  return new;
end $$;

revoke execute on function public.fn_coord_contato_travado() from public, anon, authenticated;

drop trigger if exists trg_coord_contato_travado on public.contacts;
create trigger trg_coord_contato_travado
  after update of force_human, is_blocked on public.contacts
  for each row execute function public.fn_coord_contato_travado();

-- ---------------------------------------------------------------------------
-- Central de avisos: kind novo `coordenador_preso`
-- ---------------------------------------------------------------------------
-- Reconstrução COMPLETA da constraint (a lista inteira, não um delta): é a
-- regra do bloco único (#159), e `kind-check-migration-x-baseline.test.ts`
-- compara esta lista com a do baseline.

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
    'other'
  ));

notify pgrst, 'reload schema';
