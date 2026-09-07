-- 0208 — a cascata de LGPD alcanca o motor de fluxos
--
-- A migration 0207 deu a `flow_executions` as colunas `input` e `output`. O
-- `input` recebe o payload do evento que armou a execucao: para um gatilho de
-- "mensagem recebida", e a mensagem inteira que a pessoa escreveu. O `context`
-- guarda o que os blocos anotaram sobre ela pelo caminho, e o `vars` de cada
-- frente guarda o mesmo por ramo paralelo.
--
-- Anonimizar um contato passou entao a devolver SUCESSO deixando a frase dele
-- legivel numa tabela que ninguem abre para conferir — falha muda, com o SLA da
-- LGPD marcado como cumprido. Achado por
-- `tests/invariants/lgpd-cascata-alcanca-quem-guarda-pessoa.test.ts`, que varre
-- toda tabela com FK para `contacts` e coluna de conteudo pessoal.
--
-- Forward-fix: redefine a funcao inteira com um passo 6b. Nao edita a 0207 nem
-- a migration original da cascata — a doutrina proibe reescrever migration ja
-- aplicada, e um clone que ja rodou a 0207 recebe a correcao por esta.

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

-- A funcao ja existia e ja tinha os grants certos; `create or replace` os
-- preserva. Mesmo assim as duas origens de EXECUTE sao revogadas de novo, para
-- o caso de este arquivo ser aplicado num banco onde ela nasceu agora.
revoke execute on function public.fn_lgpd_cascade_redact_contact(uuid, uuid, uuid)
  from public, anon;
grant execute on function public.fn_lgpd_cascade_redact_contact(uuid, uuid, uuid)
  to service_role;
