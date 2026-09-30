-- 0220 — Mensagem agendada pela conversa ("Lembrar" → "Agendar mensagem…").
--
-- O atendente escolhe data e hora, o texto e por qual número sai. No horário,
-- o cron `scheduled-messages` manda a mensagem ao cliente pela conversa 1:1
-- daquele número. Opcionalmente, um AVISO sai junto para um telefone que o
-- atendente digitou (o dele, normalmente), com texto próprio.
--
-- Uma linha por agendamento. `status` é o ciclo:
--   scheduled → sending (claim do cron, com `claimed_until`) → sent | queued | failed
--   scheduled → cancelled (pela tela)
-- Fora da janela de envio do número (7h–22h por padrão), o cron devolve a
-- linha a `scheduled` com `scheduled_for` na abertura da janela.
--
-- `channel_session_id` com `on delete restrict`, como `bulk_sends`: apagar um
-- número com envio marcado precisa ser decisão, não efeito colateral.
-- `contact_id` com cascade: contato apagado leva o que estava marcado para ele.
-- Anonimização (LGPD) não apaga a linha, mas o cron recusa o envio — mesma
-- régua de `checarContato`.
--
-- Idempotente. Aditiva: nenhuma linha existente tocada.

create table if not exists public.conversation_scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  channel_session_id uuid not null references public.channel_sessions(id) on delete restrict,
  body text not null,
  scheduled_for timestamptz not null,
  notify_phone text,
  notify_body text,
  status text not null default 'scheduled',
  claimed_until timestamptz,
  failure_reason text,
  message_id uuid references public.messages(id) on delete set null,
  notify_message_id uuid references public.messages(id) on delete set null,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  cancelled_at timestamptz,
  constraint conversation_scheduled_messages_status_check
    check (status in ('scheduled', 'sending', 'sent', 'queued', 'failed', 'cancelled')),
  constraint conversation_scheduled_messages_body_check
    check (char_length(body) between 1 and 4096),
  constraint conversation_scheduled_messages_notify_check check (true)
);

-- O aviso é telefone E texto, ou nenhum dos dois. `notify_body is not null`
-- explícito: `char_length(null) between ...` é NULL, e CHECK só reprova FALSE —
-- sem ele, telefone sem texto passava. Drop/add cura quem já tem a tabela.
alter table public.conversation_scheduled_messages
  drop constraint if exists conversation_scheduled_messages_notify_check;
alter table public.conversation_scheduled_messages
  add constraint conversation_scheduled_messages_notify_check
    check (
      (notify_phone is null and notify_body is null)
      or (
        notify_phone is not null
        and notify_phone ~ '^\+[0-9]{8,15}$'
        and notify_body is not null
        and char_length(notify_body) between 1 and 4096
      )
    );

-- O que o cron varre: só o que está marcado, pelo horário.
create index if not exists idx_conversation_scheduled_messages_vencidas
  on public.conversation_scheduled_messages (scheduled_for)
  where status = 'scheduled';

-- O que a tela lista: pendentes de UMA conversa.
create index if not exists idx_conversation_scheduled_messages_conversa
  on public.conversation_scheduled_messages (conversation_id, scheduled_for)
  where status = 'scheduled';

alter table public.conversation_scheduled_messages enable row level security;

-- SELECT: todo membro da org (viewer inclusive — a conversa mostra o que está
-- marcado). Escrita: `agent` para cima, o mesmo papel que o Lembrar exige.
drop policy if exists tenant_isolation_conversation_scheduled_messages_all on public.conversation_scheduled_messages;

drop policy if exists tenant_isolation_conversation_scheduled_messages_select on public.conversation_scheduled_messages;
create policy tenant_isolation_conversation_scheduled_messages_select
  on public.conversation_scheduled_messages
  for select using (
    organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin()
  );

drop policy if exists tenant_isolation_conversation_scheduled_messages_write on public.conversation_scheduled_messages;
create policy tenant_isolation_conversation_scheduled_messages_write
  on public.conversation_scheduled_messages
  for all using (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'agent'))
    or public.fn_is_platform_admin()
  ) with check (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'agent'))
    or public.fn_is_platform_admin()
  );

comment on table public.conversation_scheduled_messages is
  'Mensagem ao cliente agendada pela conversa (Lembrar → Agendar mensagem). Enviada pelo cron scheduled-messages, respeitando a janela do número; aviso opcional ao atendente em notify_phone.';

-- A cascata de LGPD alcança a mensagem agendada: `body` é texto escrito para a
-- pessoa (invariante `lgpd-cascata-alcanca-quem-guarda-pessoa`). Reescrita
-- inteira a partir da versão da 0208, com o passo 6c acrescentado.
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
