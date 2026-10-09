-- ============================================================================
-- 0232 — "A CHAVE DESTA INSTALAÇÃO" PUBLICA.
--
-- O editor oferece "a chave desta instalação" quando o `.env` do servidor tem a
-- chave do provedor, e grava a versão com `credential_id` nulo — o motor sabe
-- usar (lib/agent-engine/edge/llm/credentials.ts: credencial validada do
-- provedor, senão a chave do .env). Mas esta função recusava nulo com
-- `credential_missing`: o agente salvava e NUNCA publicava. O pior caso é o do
-- onboarding, que cria o agente já publicado por fora desta função: na primeira
-- edição, o dono não conseguia mais republicar o próprio agente.
--
-- Agora nulo passa por aqui; quem confere que há chave é `publishAgentVersion`
-- (o banco não enxerga o .env). Credencial escolhida segue conferida inteira.
-- Idempotente (create or replace) e com os revokes reemitidos.
-- ============================================================================

create or replace function public.fn_publish_ai_agent_version(
  p_org_id uuid,
  p_agent_id uuid,
  p_version_id uuid
)
returns table (
  agent_id uuid,
  version_id uuid,
  previous_version_id uuid,
  published_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_agent record;
  v_version record;
  v_credential record;
  v_session record;
  v_model_count integer;
  v_previous_version_id uuid;
  v_published_at timestamptz := now();
begin
  select a.id, a.organization_id, a.published_version_id, a.archived_at
    into v_agent
  from public.ai_agents a
  where a.id = p_agent_id
  for update;

  if not found then
    raise exception 'agent_not_found' using errcode = 'P0001';
  end if;
  if v_agent.organization_id <> p_org_id then
    raise exception 'agent_not_found' using errcode = 'P0001';
  end if;
  if v_agent.archived_at is not null then
    raise exception 'agent_archived' using errcode = 'P0001';
  end if;

  select v.id, v.organization_id, v.agent_id, v.status, v.provider, v.model,
         v.credential_id, v.channel_session_id
    into v_version
  from public.ai_agent_versions v
  where v.id = p_version_id
  for update;

  if not found then
    raise exception 'version_not_found' using errcode = 'P0001';
  end if;
  if v_version.agent_id <> p_agent_id or v_version.organization_id <> p_org_id then
    raise exception 'version_not_found' using errcode = 'P0001';
  end if;
  if v_version.status not in ('draft', 'superseded') then
    raise exception 'version_invalid_state' using errcode = 'P0001';
  end if;

  -- credential_id NULO = "a chave desta instalação" (0232). O banco não enxerga
  -- o .env do servidor; quem confere que há chave para o provedor é
  -- `publishAgentVersion` (lib/ai/agents/publish.ts), antes desta chamada.
  -- Escolhida uma credencial, ela continua sendo conferida aqui, inteira.
  if v_version.credential_id is not null then
    select c.id, c.organization_id, c.provider, c.is_active, c.validated_at
      into v_credential
    from public.ai_provider_credentials c
    where c.id = v_version.credential_id;

    if not found or v_credential.organization_id <> p_org_id then
      raise exception 'credential_not_found' using errcode = 'P0001';
    end if;
    if not v_credential.is_active then
      raise exception 'credential_inactive' using errcode = 'P0001';
    end if;
    if v_credential.validated_at is null then
      raise exception 'credential_not_validated' using errcode = 'P0001';
    end if;
    if v_credential.provider <> v_version.provider then
      raise exception 'credential_provider_mismatch' using errcode = 'P0001';
    end if;
  end if;

  select s.id, s.organization_id, s.status
    into v_session
  from public.channel_sessions s
  where s.id = v_version.channel_session_id;

  if not found or v_session.organization_id <> p_org_id then
    raise exception 'channel_session_not_found' using errcode = 'P0001';
  end if;
  if v_session.status <> 'WORKING' then
    raise exception 'channel_session_offline' using errcode = 'P0001';
  end if;

  select count(*)
    into v_model_count
  from public.ai_models m
  where m.provider = v_version.provider
    and m.model_id = v_version.model
    and m.deprecated_at is null;

  if v_model_count = 0 then
    raise exception 'model_not_found' using errcode = 'P0001';
  end if;

  v_previous_version_id := v_agent.published_version_id;

  if v_previous_version_id is not null and v_previous_version_id <> p_version_id then
    update public.ai_agent_versions
       set status = 'superseded', superseded_at = v_published_at
     where id = v_previous_version_id;
  end if;

  update public.ai_agent_versions
     set status = 'published',
         published_at = v_published_at,
         superseded_at = null
   where id = p_version_id;

  update public.ai_agents
     set published_version_id = p_version_id,
         updated_at = v_published_at
   where id = p_agent_id;

  return query
    select p_agent_id, p_version_id, v_previous_version_id, v_published_at;
end;
$$;

comment on function public.fn_publish_ai_agent_version(uuid, uuid, uuid) is
  'Troca atômica de versão publicada do agente. 0232: credential_id nulo = chave da instalação; a cobertura (chave no .env ou credencial validada do provedor) é conferida em lib/ai/agents/publish.ts antes da chamada.';

-- Hardening (item 9 da doutrina): `create or replace` não muda o ACL de quem já
-- tem a função, mas quem ATUALIZA pode tê-la recriada com o default de anon.
-- As duas origens de EXECUTE, revogadas de novo; só o service_role publica.
revoke execute on function public.fn_publish_ai_agent_version(uuid, uuid, uuid) from public, anon;
revoke execute on function public.fn_publish_ai_agent_version(uuid, uuid, uuid) from authenticated;
grant execute on function public.fn_publish_ai_agent_version(uuid, uuid, uuid) to service_role;
