-- 0230 — Coordenador: chamada agente → fluxo, e o RETORNO automático
--
-- A 0229 criou `coord_chamadas`, mas nada a escrevia. Esta migration fecha o
-- ciclo "agente chama um fluxo e volta":
--
--   1. `fn_coord_chamar_fluxo` — numa transação só: confere que quem chama é o
--      dono na geração que recebeu (fencing), cria a execução do fluxo no bloco
--      de gatilho da versão ATIVA, registra a chamada e entrega a conversa ao
--      fluxo pela única porta (`fn_coord_transicionar`). Idempotente pela
--      chave: a mesma chamada repetida (retry da ferramenta) devolve a original.
--
--   2. `fn_coord_fluxo_terminou` — trigger em `flow_executions`: quando a
--      execução chamada termina (concluída, morta ou cancelada), a chamada é
--      fechada com a SAÍDA da execução e, se a modalidade é `retorno`, a
--      conversa volta ao agente que chamou — com o despacho do turno dele no
--      outbox, na mesma transação. Trigger não faz HTTP: só escreve linha.
--
--      Se uma pessoa assumiu no meio, a conversa NÃO volta ao agente: a
--      prioridade humana de `fn_coord_transicionar` recusa e fica no diário.
--
--   3. Categoria `delegacao` no diário: uma troca pedida por um executor (o
--      agente chamou/transferiu) é diferente de uma regra, de uma decisão do
--      modelo e de uma ação manual da equipe. Sem categoria própria, a tela de
--      atividade não saberia dizer "o agente pediu".
--
-- Idempotente: create or replace, drop/add constraint, drop trigger if exists.

-- ---------------------------------------------------------------------------
-- 1. Categoria `delegacao`
-- ---------------------------------------------------------------------------
alter table public.coord_transicoes drop constraint if exists coord_transicoes_categoria_check;
alter table public.coord_transicoes add constraint coord_transicoes_categoria_check
  check (categoria in ('regra', 'continuidade', 'modelo', 'manual', 'retorno', 'recuperacao', 'fallback', 'delegacao'));

-- ---------------------------------------------------------------------------
-- 2. fn_coord_chamar_fluxo
-- ---------------------------------------------------------------------------
create or replace function public.fn_coord_chamar_fluxo(
  p_org uuid,
  p_conversa uuid,
  p_origem_agent_id uuid,
  p_origem_agent_version_id uuid,
  p_geracao_origem bigint,
  p_flow_id uuid,
  p_modalidade text,
  p_input jsonb,
  p_objetivo text,
  p_chave_idempotencia text,
  p_prazo_horas int,
  p_politica_versao_id uuid
) returns jsonb
  language plpgsql
  set search_path to 'public', 'pg_temp'
as $$
declare
  v_existente public.coord_chamadas%rowtype;
  v_estado public.coord_estado_conversa%rowtype;
  v_conversa record;
  v_versao_id uuid;
  v_no text;
  v_execucao uuid;
  v_chamada uuid;
  v_r jsonb;
begin
  if p_modalidade not in ('retorno', 'definitiva') then
    return jsonb_build_object('ok', false, 'motivo', 'modalidade_invalida');
  end if;

  -- Retry da ferramenta: a mesma intenção devolve a chamada original.
  select * into v_existente from public.coord_chamadas
   where organization_id = p_org and chave_idempotencia = p_chave_idempotencia;
  if found then
    return jsonb_build_object('ok', true, 'ja_existia', true, 'chamada_id', v_existente.id,
                              'execution_id', v_existente.destino_execution_id, 'status', v_existente.status);
  end if;

  select id, contact_id, channel_session_id into v_conversa
    from public.conversations where organization_id = p_org and id = p_conversa;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'conversa_inexistente');
  end if;

  -- Fencing: só o dono, na geração que recebeu, delega.
  select * into v_estado from public.coord_estado_conversa
   where organization_id = p_org and conversation_id = p_conversa
   for update;
  if not found or v_estado.dono_tipo <> 'agente' or v_estado.dono_agent_id is distinct from p_origem_agent_id then
    return jsonb_build_object('ok', false, 'motivo', 'nao_e_o_dono');
  end if;
  if v_estado.geracao <> p_geracao_origem then
    return jsonb_build_object('ok', false, 'motivo', 'geracao_obsoleta');
  end if;

  -- Só fluxo ATIVO, pela versão ativa, a partir do bloco de gatilho.
  select f.active_version_id into v_versao_id
    from public.flows f
   where f.organization_id = p_org and f.id = p_flow_id and f.status = 'active';
  if v_versao_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'destino_inelegivel');
  end if;
  select (select n ->> 'id' from jsonb_array_elements(v.graph -> 'nodes') n
           where n ->> 'type' like 'trigger.%' limit 1)
    into v_no
    from public.flow_versions v
   where v.organization_id = p_org and v.id = v_versao_id;
  if v_no is null then
    return jsonb_build_object('ok', false, 'motivo', 'destino_inelegivel');
  end if;

  insert into public.flow_executions
    (organization_id, flow_id, version_id, status, current_node_id, next_eval_at,
     contact_id, conversation_id, input, context, lineage)
  values
    (p_org, p_flow_id, v_versao_id, 'pending', v_no, now(),
     v_conversa.contact_id, p_conversa,
     coalesce(p_input, '{}'::jsonb) || jsonb_build_object(
       'conversation_id', p_conversa,
       'contact_id', v_conversa.contact_id,
       'channel_session_id', v_conversa.channel_session_id),
     '{}'::jsonb,
     jsonb_build_object('origem', 'coordenador', 'chamada_por_agente', p_origem_agent_id))
  returning id into v_execucao;

  insert into public.coord_chamadas
    (organization_id, conversation_id, modalidade, modo_destino, origem_tipo,
     origem_agent_id, origem_agent_version_id, destino_tipo, destino_flow_id,
     destino_execution_id, status, objetivo, input, prazo, geracao_origem, chave_idempotencia)
  values
    (p_org, p_conversa, p_modalidade, 'conduzir', 'agente',
     p_origem_agent_id, p_origem_agent_version_id, 'fluxo', p_flow_id,
     v_execucao, 'ativa', left(p_objetivo, 500), coalesce(p_input, '{}'::jsonb),
     now() + make_interval(hours => greatest(1, least(coalesce(p_prazo_horas, 24), 168))),
     p_geracao_origem, p_chave_idempotencia)
  returning id into v_chamada;

  v_r := public.fn_coord_transicionar(
    p_org, p_conversa, v_estado.versao, 'fluxo', null, null, v_execucao, null,
    'ativo', 'delegacao',
    case when p_modalidade = 'retorno' then 'agente_chamou_fluxo' else 'agente_transferiu' end,
    p_politica_versao_id, null, v_chamada, null,
    jsonb_build_object('modalidade', p_modalidade));
  if coalesce((v_r ->> 'ok')::boolean, false) is not true then
    -- A execução e a chamada não podem sobreviver a uma troca recusada: seriam
    -- um fluxo falando sem dono. Exceção desfaz tudo o que esta chamada fez.
    raise exception 'coord_chamada_recusada:%', coalesce(v_r ->> 'motivo', 'desconhecido');
  end if;

  return jsonb_build_object('ok', true, 'ja_existia', false, 'chamada_id', v_chamada,
                            'execution_id', v_execucao, 'geracao', (v_r ->> 'geracao')::bigint);
end $$;

revoke execute on function public.fn_coord_chamar_fluxo(
  uuid, uuid, uuid, uuid, bigint, uuid, text, jsonb, text, text, int, uuid
) from public, anon, authenticated;
grant execute on function public.fn_coord_chamar_fluxo(
  uuid, uuid, uuid, uuid, bigint, uuid, text, jsonb, text, text, int, uuid
) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Retorno: a execução chamada terminou
-- ---------------------------------------------------------------------------
create or replace function public.fn_coord_fluxo_terminou()
returns trigger
  language plpgsql
  security definer
  set search_path to 'public', 'pg_temp'
as $$
declare
  v_chamada public.coord_chamadas%rowtype;
  v_estado public.coord_estado_conversa%rowtype;
  v_conversa record;
  v_status text;
  v_mensagem uuid;
  v_r jsonb;
begin
  v_status := case new.status
    when 'completed' then 'concluida'
    when 'cancelled' then 'cancelada'
    else 'falhou'
  end;

  for v_chamada in
    select * from public.coord_chamadas
     where organization_id = new.organization_id
       and destino_execution_id = new.id
       and status in ('pendente', 'ativa')
     for update
  loop
    update public.coord_chamadas
       set status = v_status,
           output = coalesce(new.output, '{}'::jsonb),
           motivo_fim = coalesce(new.outcome, new.last_error, new.status),
           concluida_em = now(),
           updated_at = now()
     where id = v_chamada.id;

    if v_chamada.modalidade <> 'retorno' or v_chamada.origem_tipo <> 'agente'
       or v_chamada.origem_agent_id is null then
      continue;
    end if;

    -- Só volta se o fluxo AINDA é o dono. Se a conversa já mudou de mão (uma
    -- pessoa assumiu, outra decisão), o retorno atrasado não a toma de volta.
    select * into v_estado from public.coord_estado_conversa
     where organization_id = new.organization_id and conversation_id = v_chamada.conversation_id;
    if not found or v_estado.dono_tipo <> 'fluxo' or v_estado.dono_execution_id is distinct from new.id then
      continue;
    end if;

    select id, contact_id, channel_session_id into v_conversa
      from public.conversations
     where organization_id = new.organization_id and id = v_chamada.conversation_id;
    -- O turno do agente nasce do mesmo evento que o webhook emite; ele exige
    -- a última mensagem do cliente como âncora.
    select m.id into v_mensagem from public.messages m
     where m.organization_id = new.organization_id and m.conversation_id = v_chamada.conversation_id
       and m.direction = 'inbound'
     order by m.sent_at desc, m.created_at desc, m.id desc
     limit 1;

    v_r := public.fn_coord_transicionar(
      new.organization_id, v_chamada.conversation_id, v_estado.versao,
      'agente', v_chamada.origem_agent_id, v_chamada.origem_agent_version_id, null, null,
      'ativo', 'retorno',
      case v_status when 'concluida' then 'retorno_da_chamada'
                    when 'cancelada' then 'chamada_cancelada'
                    else 'retorno_da_chamada' end,
      v_estado.politica_versao_id, null, v_chamada.id,
      case when v_mensagem is null then null else jsonb_build_object(
        'event_type', 'ai_agent.dispatch_requested',
        'payload', jsonb_build_object(
          'conversation_id', v_chamada.conversation_id,
          'contact_id', v_conversa.contact_id,
          'channel_session_id', v_conversa.channel_session_id,
          'inbound_message_id', v_mensagem,
          'imediato', true,
          'coord_chamada_id', v_chamada.id)) end,
      jsonb_build_object('desfecho_da_chamada', v_status));
  end loop;
  return new;
end $$;

revoke execute on function public.fn_coord_fluxo_terminou() from public, anon, authenticated;

drop trigger if exists trg_coord_fluxo_terminou on public.flow_executions;
create trigger trg_coord_fluxo_terminou
  after update of status on public.flow_executions
  for each row
  when (new.status in ('completed', 'dead', 'cancelled') and old.status is distinct from new.status)
  execute function public.fn_coord_fluxo_terminou();
