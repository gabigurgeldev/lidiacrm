-- ============================================================================
-- 0223 — INTEGRAÇÕES VIA API: o agente consulta o sistema do cliente.
--
-- A organização cadastra uma API (URL, credencial, endpoints) na Central de IA
-- e liga os endpoints a um agente. O agente passa a buscar dado de fora para
-- responder — e, quando o endpoint é uma AÇÃO, a propor uma correção que só
-- roda depois que o cliente responde SIM.
--
-- ═══ O que impede o agente de ver a conta de outra pessoa ═══
--
-- O id da conta NUNCA é entrada do modelo. Ele sai de `ai_api_verificacoes`,
-- depois que o cliente digita no WhatsApp o código que chegou no e-mail da
-- conta, e o servidor o injeta no caminho (`{{conta.id}}`). O código e o SIM
-- são conferidos pelo runtime, antes do modelo rodar, a partir das mensagens
-- gravadas — o modelo só PEDE a verificação e só PROPÕE a ação.
--
-- ═══ As seis tabelas ═══
--
--   ai_api_integrations        — a API (manager lê, admin escreve)
--   ai_api_integration_secrets — o segredo cifrado (só o servidor)
--   ai_api_endpoints           — o que o agente pode chamar (manager lê, admin escreve)
--   ai_api_verificacoes        — o código por e-mail (só o servidor)
--   ai_api_acoes_pendentes     — a ação esperando o SIM (manager lê; só o servidor escreve)
--   ai_api_chamadas            — log sem payload; alimenta o circuito (manager lê)
--
-- Mais: `ai_agent_versions.api_endpoint_ids` (com o trigger de imutabilidade),
-- três kinds novos na Central, e o passo 6d da cascata de LGPD.
--
-- Aditiva e idempotente: tabelas novas, coluna com default, constraint só
-- alarga, função `create or replace`.
-- ============================================================================

-- ---- tabelas: a integração, o segredo dela, os endpoints ----

create table if not exists public.ai_api_integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  nome text not null,
  descricao text,
  tipo text not null default 'generica',
  base_url text not null,
  auth_tipo text not null default 'nenhuma',
  auth_header_nome text,
  segredo_last4 text,
  identidade_modo text not null default 'nenhuma',
  identidade_endpoint_id uuid,
  sessao_horas integer not null default 4,
  ativo boolean not null default true,
  arquivada_em timestamptz,
  ultimo_teste_em timestamptz,
  ultimo_teste_ok boolean,
  ultimo_teste_erro text,
  falhas_consecutivas integer not null default 0,
  circuito_aberto_ate timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ai_api_integrations_nome_unico
  on public.ai_api_integrations (organization_id, lower(nome))
  where arquivada_em is null;
create index if not exists ai_api_integrations_org_idx
  on public.ai_api_integrations (organization_id, created_at desc);

alter table public.ai_api_integrations drop constraint if exists ai_api_integrations_tipo_check;
alter table public.ai_api_integrations add constraint ai_api_integrations_tipo_check
  check (tipo in ('generica', 'suporte_v1'));
alter table public.ai_api_integrations drop constraint if exists ai_api_integrations_auth_tipo_check;
alter table public.ai_api_integrations add constraint ai_api_integrations_auth_tipo_check
  check (auth_tipo in ('nenhuma', 'bearer', 'header', 'hmac_sha256', 'suporte_v1'));
alter table public.ai_api_integrations drop constraint if exists ai_api_integrations_identidade_modo_check;
alter table public.ai_api_integrations add constraint ai_api_integrations_identidade_modo_check
  check (identidade_modo in ('nenhuma', 'email_otp'));
alter table public.ai_api_integrations drop constraint if exists ai_api_integrations_base_url_check;
alter table public.ai_api_integrations add constraint ai_api_integrations_base_url_check
  check (base_url ~ '^https?://[^\s]+$' and char_length(base_url) <= 500);
alter table public.ai_api_integrations drop constraint if exists ai_api_integrations_sessao_horas_check;
alter table public.ai_api_integrations add constraint ai_api_integrations_sessao_horas_check
  check (sessao_horas between 1 and 24);
alter table public.ai_api_integrations drop constraint if exists ai_api_integrations_nome_check;
alter table public.ai_api_integrations add constraint ai_api_integrations_nome_check
  check (char_length(nome) between 1 and 80);

-- O segredo mora em tabela À PARTE, sem policy: a tela lista integrações com a
-- anon key do browser, e uma coluna cifrada na mesma linha seria uma coluna a
-- um `select *` de distância. Mesma decisão da 0221.
create table if not exists public.ai_api_integration_secrets (
  integration_id uuid primary key references public.ai_api_integrations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  segredo_encrypted bytea not null,
  segredo_iv bytea not null,
  segredo_tag bytea not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_api_endpoints (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  integration_id uuid not null references public.ai_api_integrations(id) on delete cascade,
  slug text not null,
  titulo text not null,
  descricao_para_ia text not null default '',
  metodo text not null default 'GET',
  caminho text not null,
  parametros jsonb not null default '[]'::jsonb,
  corpo_fixo jsonb,
  modo text not null default 'leitura',
  exige_identidade boolean not null default false,
  texto_de_confirmacao text,
  campos_da_resposta text[] not null default '{}'::text[],
  timeout_ms integer not null default 8000,
  ativo boolean not null default true,
  origem text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ai_api_endpoints_slug_unico
  on public.ai_api_endpoints (integration_id, slug);
create index if not exists ai_api_endpoints_org_idx
  on public.ai_api_endpoints (organization_id, integration_id);

alter table public.ai_api_endpoints drop constraint if exists ai_api_endpoints_slug_check;
alter table public.ai_api_endpoints add constraint ai_api_endpoints_slug_check
  check (slug ~ '^[a-z][a-z0-9_]{2,40}$');
alter table public.ai_api_endpoints drop constraint if exists ai_api_endpoints_metodo_check;
alter table public.ai_api_endpoints add constraint ai_api_endpoints_metodo_check
  check (metodo in ('GET', 'POST', 'PUT', 'PATCH', 'DELETE'));
alter table public.ai_api_endpoints drop constraint if exists ai_api_endpoints_caminho_check;
alter table public.ai_api_endpoints add constraint ai_api_endpoints_caminho_check
  check (caminho ~ '^/' and char_length(caminho) <= 300);
alter table public.ai_api_endpoints drop constraint if exists ai_api_endpoints_modo_check;
alter table public.ai_api_endpoints add constraint ai_api_endpoints_modo_check
  check (modo in ('leitura', 'acao', 'identidade'));
-- Ação sem texto de confirmação não existe: é o texto que o cliente lê antes de
-- responder SIM. Sem ele, o "sim" confirmaria uma frase que o modelo escreveu.
alter table public.ai_api_endpoints drop constraint if exists ai_api_endpoints_confirmacao_check;
alter table public.ai_api_endpoints add constraint ai_api_endpoints_confirmacao_check
  check (modo <> 'acao' or char_length(coalesce(texto_de_confirmacao, '')) between 5 and 500);
alter table public.ai_api_endpoints drop constraint if exists ai_api_endpoints_timeout_check;
alter table public.ai_api_endpoints add constraint ai_api_endpoints_timeout_check
  check (timeout_ms between 1000 and 15000);
alter table public.ai_api_endpoints drop constraint if exists ai_api_endpoints_origem_check;
alter table public.ai_api_endpoints add constraint ai_api_endpoints_origem_check
  check (origem in ('manual', 'catalogo_suporte_v1'));
alter table public.ai_api_endpoints drop constraint if exists ai_api_endpoints_parametros_check;
alter table public.ai_api_endpoints add constraint ai_api_endpoints_parametros_check
  check (jsonb_typeof(parametros) = 'array');

alter table public.ai_api_integrations drop constraint if exists ai_api_integrations_identidade_endpoint_fk;
alter table public.ai_api_integrations add constraint ai_api_integrations_identidade_endpoint_fk
  foreign key (identidade_endpoint_id) references public.ai_api_endpoints(id) on delete set null;

-- ---- verificação de identidade: o código que o cliente digita ----
--
-- Uma verificação vale para a CONVERSA, não para um sistema: o cliente prova o
-- e-mail uma vez e a busca roda em toda integração com identidade do agente.
-- `contas` guarda o que cada sistema devolveu ([{integracao_id, subject_id,
-- nome}]); `selecionadas` mapeia integracao_id -> subject_id escolhido. Schema
-- central em lib/ai/integracoes/schema.ts — ninguém lê o path solto.
create table if not exists public.ai_api_verificacoes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  email_hash text not null,
  email_mascarado text not null,
  email_encrypted bytea,
  email_iv bytea,
  email_tag bytea,
  codigo_hash text,
  tentativas integer not null default 0,
  ultima_mensagem_tentada_id uuid,
  status text not null default 'pendente',
  codigo_expira_em timestamptz not null,
  verificado_em timestamptz,
  valido_ate timestamptz,
  contas jsonb not null default '[]'::jsonb,
  selecionadas jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.ai_api_verificacoes drop constraint if exists ai_api_verificacoes_status_check;
alter table public.ai_api_verificacoes add constraint ai_api_verificacoes_status_check
  check (status in ('pendente', 'verificado', 'bloqueado', 'expirado', 'substituido'));

create index if not exists ai_api_verificacoes_conversa_idx
  on public.ai_api_verificacoes (organization_id, conversation_id, created_at desc);
create index if not exists ai_api_verificacoes_email_idx
  on public.ai_api_verificacoes (organization_id, email_hash, created_at desc);

-- ---- ação proposta pelo agente, esperando o SIM do cliente ----
create table if not exists public.ai_api_acoes_pendentes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  endpoint_id uuid not null references public.ai_api_endpoints(id) on delete cascade,
  agent_id uuid references public.ai_agents(id) on delete set null,
  verificacao_id uuid references public.ai_api_verificacoes(id) on delete set null,
  subject_id text,
  params_congelados jsonb not null default '{}'::jsonb,
  resumo text not null,
  oferta_message_id uuid,
  oferta_enviada_em timestamptz,
  status text not null default 'aguardando',
  confirmada_por_message_id uuid,
  resultado text,
  erro_codigo text,
  expira_em timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ai_api_acoes_pendentes drop constraint if exists ai_api_acoes_pendentes_status_check;
alter table public.ai_api_acoes_pendentes add constraint ai_api_acoes_pendentes_status_check
  check (status in ('aguardando', 'executando', 'executada', 'falhou', 'cancelada', 'expirada'));

-- Uma ação esperando por conversa: duas ofertas abertas fariam o "sim" do
-- cliente valer para a que ele não leu por último. Corrige antes de criar o
-- índice (re-aplicação em banco que já tem linhas).
update public.ai_api_acoes_pendentes a
   set status = 'cancelada', updated_at = now()
 where a.status = 'aguardando'
   and exists (
     select 1 from public.ai_api_acoes_pendentes b
      where b.conversation_id = a.conversation_id
        and b.status = 'aguardando'
        and (b.created_at, b.id) > (a.created_at, a.id)
   );
create unique index if not exists ai_api_acoes_pendentes_uma_por_conversa
  on public.ai_api_acoes_pendentes (conversation_id)
  where status = 'aguardando';
create index if not exists ai_api_acoes_pendentes_org_idx
  on public.ai_api_acoes_pendentes (organization_id, created_at desc);

-- ---- log de chamadas: alimenta o circuito e a tela ----
create table if not exists public.ai_api_chamadas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  integration_id uuid not null references public.ai_api_integrations(id) on delete cascade,
  endpoint_id uuid references public.ai_api_endpoints(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  origem text not null,
  http_status integer,
  ok boolean not null,
  erro_codigo text,
  duracao_ms integer,
  bytes_resposta integer,
  created_at timestamptz not null default now()
);

alter table public.ai_api_chamadas drop constraint if exists ai_api_chamadas_origem_check;
alter table public.ai_api_chamadas add constraint ai_api_chamadas_origem_check
  check (origem in ('agente', 'teste', 'verificacao', 'acao', 'importacao'));

create index if not exists ai_api_chamadas_integracao_idx
  on public.ai_api_chamadas (organization_id, integration_id, created_at desc);

-- ---- RLS ----
alter table public.ai_api_integrations enable row level security;
alter table public.ai_api_integration_secrets enable row level security;
alter table public.ai_api_endpoints enable row level security;
alter table public.ai_api_verificacoes enable row level security;
alter table public.ai_api_acoes_pendentes enable row level security;
alter table public.ai_api_chamadas enable row level security;

-- Configuração: manager lê (a tela e o formulário do agente), admin escreve
-- (é quem decide para onde o agente manda dado de cliente).
drop policy if exists tenant_isolation_ai_api_integrations_select on public.ai_api_integrations;
create policy tenant_isolation_ai_api_integrations_select on public.ai_api_integrations
  for select using (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'manager'))
    or public.fn_is_platform_admin()
  );
drop policy if exists tenant_isolation_ai_api_integrations_write on public.ai_api_integrations;
create policy tenant_isolation_ai_api_integrations_write on public.ai_api_integrations
  for all using (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin'))
    or public.fn_is_platform_admin()
  ) with check (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin'))
    or public.fn_is_platform_admin()
  );

drop policy if exists tenant_isolation_ai_api_endpoints_select on public.ai_api_endpoints;
create policy tenant_isolation_ai_api_endpoints_select on public.ai_api_endpoints
  for select using (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'manager'))
    or public.fn_is_platform_admin()
  );
drop policy if exists tenant_isolation_ai_api_endpoints_write on public.ai_api_endpoints;
create policy tenant_isolation_ai_api_endpoints_write on public.ai_api_endpoints
  for all using (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin'))
    or public.fn_is_platform_admin()
  ) with check (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin'))
    or public.fn_is_platform_admin()
  );

-- Execução: manager lê o histórico; ninguém escreve pela anon key — quem grava
-- é o worker e a rota, com service role.
drop policy if exists tenant_isolation_ai_api_acoes_pendentes_select on public.ai_api_acoes_pendentes;
create policy tenant_isolation_ai_api_acoes_pendentes_select on public.ai_api_acoes_pendentes
  for select using (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'manager'))
    or public.fn_is_platform_admin()
  );
drop policy if exists tenant_isolation_ai_api_chamadas_select on public.ai_api_chamadas;
create policy tenant_isolation_ai_api_chamadas_select on public.ai_api_chamadas
  for select using (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'manager'))
    or public.fn_is_platform_admin()
  );
revoke insert, update, delete, truncate on public.ai_api_acoes_pendentes from anon, authenticated;
revoke insert, update, delete, truncate on public.ai_api_chamadas from anon, authenticated;

-- Segredo e verificação: sem policy e sem privilégio. O código de verificação
-- (mesmo em hash) e o e-mail cifrado não têm leitor legítimo fora do servidor.
revoke all on public.ai_api_integration_secrets from anon, authenticated;
revoke all on public.ai_api_verificacoes from anon, authenticated;
revoke all on public.ai_api_integrations from anon;
revoke all on public.ai_api_endpoints from anon;
revoke all on public.ai_api_acoes_pendentes from anon;
revoke all on public.ai_api_chamadas from anon;

comment on table public.ai_api_integrations is
  'Integrações via API: sistema externo que o agente consulta (Central de IA › Integrações via API). Segredo em ai_api_integration_secrets.';
comment on table public.ai_api_integration_secrets is
  'Segredo da integração cifrado em AES-256-GCM (AI_CRED_AES_KEY). Sem policy: só o servidor lê.';
comment on table public.ai_api_endpoints is
  'Endpoint de uma integração: leitura, ação (exige SIM do cliente) ou identidade (busca de conta por e-mail). Parâmetros validados por lib/ai/integracoes/schema.ts.';
comment on table public.ai_api_verificacoes is
  'Código de verificação por e-mail que prova ao agente que o cliente é dono da conta no sistema externo. Só o servidor lê.';
comment on table public.ai_api_acoes_pendentes is
  'Ação que o agente propôs e o cliente ainda não confirmou; o runtime executa só depois de um SIM na primeira mensagem seguinte à oferta.';
comment on table public.ai_api_chamadas is
  'Log de chamadas às integrações (sem payload): saúde na tela e circuito que pausa a integração que falha em série.';

-- ---- a versão do agente escolhe os endpoints ----
alter table public.ai_agent_versions
  add column if not exists api_endpoint_ids uuid[] not null default '{}'::uuid[];
comment on column public.ai_agent_versions.api_endpoint_ids is
  'Endpoints de Integrações via API que esta versão do agente pode chamar. Mesmo padrão de knowledge_source_ids (0181).';

-- ---- o trigger de imutabilidade aprende api_endpoint_ids ----
create or replace function fn_ai_agent_version_content_immutable() returns trigger
language plpgsql as $fn$
begin
  if old.status <> 'draft' and (
       new.system_prompt          is distinct from old.system_prompt
    or new.provider               is distinct from old.provider
    or new.model                  is distinct from old.model
    or new.credential_id          is distinct from old.credential_id
    or new.tool_ids               is distinct from old.tool_ids
    or new.trigger_config         is distinct from old.trigger_config
    or new.channel_session_id     is distinct from old.channel_session_id
    or new.max_steps              is distinct from old.max_steps
    or new.token_budget           is distinct from old.token_budget
    or new.cost_budget_cents      is distinct from old.cost_budget_cents
    or new.history_message_window is distinct from old.history_message_window
    or new.history_token_window   is distinct from old.history_token_window
    or new.handoff_keywords       is distinct from old.handoff_keywords
    or new.handoff_tool_enabled   is distinct from old.handoff_tool_enabled
    or new.followup               is distinct from old.followup
    or new.multimodal_input       is distinct from old.multimodal_input
    or new.video_frames_enabled   is distinct from old.video_frames_enabled
    or new.split_messages         is distinct from old.split_messages
    or new.split_max_chars        is distinct from old.split_max_chars
    or new.reply_as_audio         is distinct from old.reply_as_audio
    or new.audio_voice            is distinct from old.audio_voice
    or new.cases_enabled          is distinct from old.cases_enabled
    or new.operator_enabled       is distinct from old.operator_enabled
    or new.operator_model         is distinct from old.operator_model
    or new.operator_tool_ids      is distinct from old.operator_tool_ids
    or new.pipeline_ids           is distinct from old.pipeline_ids
    or new.knowledge_source_ids   is distinct from old.knowledge_source_ids
    or new.api_endpoint_ids       is distinct from old.api_endpoint_ids
    or new.version_number         is distinct from old.version_number
    or new.agent_id               is distinct from old.agent_id
    or new.organization_id        is distinct from old.organization_id
  ) then
    raise exception 'ai_agent_versions % é imutável (status=%): mudança de conteúdo = versão draft nova; rollback = revert (clona + publica)',
      old.id, old.status;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_ai_agent_versions_content_immutable on public.ai_agent_versions;
create trigger trg_ai_agent_versions_content_immutable
  before update on public.ai_agent_versions
  for each row execute function fn_ai_agent_version_content_immutable();


-- A cascata de LGPD alcança as Integrações via API. Reescrita inteira a
-- partir da versão da 0220, com o passo 6d acrescentado.
CREATE OR REPLACE FUNCTION "public"."fn_lgpd_cascade_redact_contact"("p_organization_id" "uuid", "p_contact_id" "uuid", "p_request_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_already bool;
  v_counts jsonb := '{}'::jsonb;
  v_media_paths text[] := '{}';
  v_anon_label text;
  v_count int;
begin
  select is_anonymized into v_already
    from contacts
    where id = p_contact_id and organization_id = p_organization_id;

  if not found then
    raise exception 'contact not found' using errcode = 'P0002';
  end if;

  if v_already then
    return jsonb_build_object('already_anonymized', true, 'counts', v_counts, 'media_paths', v_media_paths);
  end if;

  v_anon_label := 'Cliente Anonimizado #' || substring(p_contact_id::text from 1 for 8);

  -- Collect media storage paths (we only delete what we own — media_storage_path)
  select coalesce(array_agg(distinct media_storage_path) filter (where media_storage_path is not null), '{}')
    into v_media_paths
    from messages
    where organization_id = p_organization_id
      and conversation_id in (
        select id from conversations
          where contact_id = p_contact_id and organization_id = p_organization_id
      );

  -- 1. contacts (irreversible)
  update contacts set
    name = v_anon_label,
    display_name = v_anon_label,
    email = null,
    -- email_normalized NÃO entra: é GENERATED ALWAYS AS (lower(trim(email)))
    -- e o Postgres recusa escrita nela — a linha acima já a zera por derivação.
    -- Com a atribuição, o cascade INTEIRO abortava e nada era anonimizado.
    phone_number = null,
    cpf_encrypted = null,
    cpf_hash = null,
    birthdate = null,
    is_anonymized = true,
    anonymized_at = now(),
    consent = '{}'::jsonb,
    source_metadata = '{}'::jsonb,
    tags = '{}'::text[],
    updated_at = now()
  where id = p_contact_id and organization_id = p_organization_id;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('contacts', v_count);

  -- 2. conversations metadata + preview strip
  update conversations set
    metadata = '{}'::jsonb,
    last_message_preview = null,
    updated_at = now()
  where contact_id = p_contact_id and organization_id = p_organization_id;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('conversations', v_count);

  -- 3. messages: redact body + null media + strip metadata (preserve status/timestamps/conversation_id)
  update messages set
    body = '[mensagem anonimizada]',
    media_url = null,
    media_mime = null,
    media_size_bytes = null,
    media_storage_path = null,
    metadata = '{}'::jsonb,
    updated_at = now()
  where organization_id = p_organization_id
    and conversation_id in (
      select id from conversations
        where contact_id = p_contact_id and organization_id = p_organization_id
    );
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('messages', v_count);

  -- 4. crm_lead_activities — strip payload, metadata E reason (migration 0071).
  --    `reason` é texto livre escrito por LLM sobre a conversa do lead: supor que
  --    nunca conterá um nome é a suposição que falha. `evidence` NÃO é limpa —
  --    guarda só ids, e as linhas apontadas são redigidas por conta própria.
  update crm_lead_activities set
    payload = '{}'::jsonb,
    metadata = '{}'::jsonb,
    reason = null
  where organization_id = p_organization_id
    and (
      contact_id = p_contact_id
      or lead_id in (
        select lead_id from crm_lead_links
          where target_kind = 'contact'
            and target_id = p_contact_id
            and organization_id = p_organization_id
      )
      or lead_id in (
        select id from crm_leads
          where contact_id = p_contact_id and organization_id = p_organization_id
      )
    );
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('activities', v_count);

  -- 5. crm_leads — strip title/description/custom_fields/source_metadata/tags but PRESERVE pipeline/stage/value
  update crm_leads set
    title = v_anon_label,
    description = null,
    custom_fields = '{}'::jsonb,
    source_metadata = '{}'::jsonb,
    tags = '{}'::text[],
    updated_at = now()
  where organization_id = p_organization_id
    and (
      contact_id = p_contact_id
      or id in (
        select lead_id from crm_lead_links
          where target_kind = 'contact'
            and target_id = p_contact_id
            and organization_id = p_organization_id
      )
    );
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('leads', v_count);

  -- 6. orders — PRESERVE values + status + timestamps. Strip personal fields from payload jsonb
  --    and replace customer_external_id with null (FK-safe; soft de-link). Keep contact_id null.
  update orders set
    payload = (coalesce(payload, '{}'::jsonb))
      - 'customer'
      - 'customer_name'
      - 'customer_email'
      - 'customer_phone'
      - 'shipping_address'
      - 'billing_address'
      - 'contact_identification',
    customer_external_id = null,
    contact_id = null,
    is_anonymized = true,
    updated_at = now()
  where organization_id = p_organization_id
    and contact_id = p_contact_id;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('orders', v_count);

  -- 6b. flow_executions + as frentes (migration 0208).
  --
  -- ⚠️ Esta tabela guarda TEXTO DE CLIENTE, e isso é recente: a 0207 deu a ela
  -- `input`, que recebe o payload do evento que armou a execução — para um
  -- gatilho de "mensagem recebida", é a mensagem inteira que a pessoa escreveu.
  -- `context` guarda o que os blocos anotaram sobre ela pelo caminho, e
  -- `flow_execution_frames.vars` guarda o mesmo por ramo paralelo.
  --
  -- Sem este passo, anonimizar um contato devolvia SUCESSO e a frase dele
  -- continuava legível numa tabela que ninguém abre para conferir. A falha é
  -- muda e o SLA da LGPD é marcado como cumprido — que é o pior desfecho
  -- possível de um pedido de anonimização.
  --
  -- Preserva o ESQUELETO (status, desfecho, relógios, qual fluxo, qual nó):
  -- é o histórico operacional de que a automação rodou, e ele não identifica
  -- ninguém depois que o conteúdo sai.
  update flow_execution_frames set
    vars = '{}'::jsonb,
    awaiting_match = null
  where organization_id = p_organization_id
    and execution_id in (
      select id from flow_executions
        where organization_id = p_organization_id
          and contact_id = p_contact_id
    );
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('flow_frames', v_count);

  update flow_executions set
    input = '{}'::jsonb,
    output = '{}'::jsonb,
    context = '{}'::jsonb,
    lineage = '{}'::jsonb,
    last_error = null
  where organization_id = p_organization_id
    and contact_id = p_contact_id;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('flow_executions', v_count);

  -- 6c. mensagens agendadas pela conversa (migration 0220). O texto é o que o
  -- atendente escreveu PARA a pessoa; o que ainda não saiu é desmarcado, para o
  -- cron não mandar mensagem a um titular que pediu para ser apagado.
  update conversation_scheduled_messages set
    body = '[anonimizado]',
    notify_body = case when notify_body is null then null else '[anonimizado]' end,
    status = case when status = 'scheduled' then 'cancelled' else status end,
    cancelled_at = case when status = 'scheduled' then now() else cancelled_at end
  where organization_id = p_organization_id
    and contact_id = p_contact_id;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('scheduled_messages', v_count);

  -- 6d. Integrações via API (migration 0223). A verificação guarda o e-mail
  -- que a pessoa informou (cifrado) — apaga a linha inteira, não há esqueleto
  -- operacional que valha guardar. A ação proposta guarda os parâmetros e o
  -- resumo que o cliente leu: o conteúdo sai, o histórico de que uma ação
  -- rodou (status, relógios, qual endpoint) fica; e o que ainda esperava o SIM
  -- é cancelado, para não executar nada em nome de quem pediu para ser apagado.
  delete from ai_api_verificacoes
  where organization_id = p_organization_id
    and contact_id = p_contact_id;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('api_verificacoes', v_count);

  update ai_api_acoes_pendentes set
    params_congelados = '{}'::jsonb,
    resumo = '[anonimizado]',
    resultado = null,
    subject_id = null,
    status = case when status = 'aguardando' then 'cancelada' else status end,
    updated_at = now()
  where organization_id = p_organization_id
    and contact_id = p_contact_id;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('api_acoes', v_count);

  -- 7. enqueue media for async deletion (idempotent via unique (bucket, object_path))
  if array_length(v_media_paths, 1) > 0 then
    insert into storage_redaction_queue (organization_id, request_id, bucket, object_path)
    select p_organization_id, p_request_id, 'whatsapp-media', path
      from unnest(v_media_paths) as path
      where path is not null and length(path) > 0
    on conflict (bucket, object_path) do nothing;
  end if;

  -- 8. dense audit row
  insert into api_audit_log (organization_id, action, actor_user_id, resource_type, resource_id, metadata, bypassed_rls)
  values (
    p_organization_id,
    'lgpd.redact_executed',
    null,
    'contact',
    p_contact_id,
    jsonb_build_object(
      'cascaded_to', v_counts,
      'media_queued', coalesce(array_length(v_media_paths, 1), 0),
      'request_id', p_request_id
    ),
    true
  );

  return jsonb_build_object(
    'already_anonymized', false,
    'counts', v_counts,
    'media_paths', v_media_paths
  );
end;
$$;

revoke execute on function public.fn_lgpd_cascade_redact_contact(uuid, uuid, uuid)
  from public, anon;
grant execute on function public.fn_lgpd_cascade_redact_contact(uuid, uuid, uuid)
  to service_role;

-- ──────── agent_inbox_items.kind ganha os três avisos das integrações ────────
--
-- Bloco ÚNICO com o vocabulário INTEIRO vigente (issue #159).
--   integracao_api_falhando — a integração falhou em série e o circuito pausou
--   acao_externa_falhou     — o cliente confirmou e a ação não rodou
--   verificacao_bloqueada   — código errado demais: alguém pode estar tentando
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
    'other'
  ));

notify pgrst, 'reload schema';
