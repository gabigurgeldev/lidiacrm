-- 0237 — Coordenador: o fluxo que termina devolve a conversa, e o fluxo que
-- perdeu a conversa para de falar.
--
-- Dois buracos da 0229/0230, os dois de "quem fala agora":
--
--   1. FLUXO DONO QUE TERMINA SEM DEVOLVER. O trigger `fn_coord_fluxo_terminou`
--      só tratava a execução nascida de uma CHAMADA com retorno. Um fluxo que o
--      coordenador escolheu como destino, que um agente transferiu de vez ou que
--      a equipe ativou, ao terminar sem o bloco "entregar ao agente", deixava o
--      estado em `dono=fluxo` apontando para uma execução morta. Ninguém falava
--      até o cliente escrever de novo — e, se a decisão seguinte não achasse
--      destino, o vigia não via a conversa (ele só olhava `nenhum`/`agente`).
--
--      Agora `fn_coord_liberar_fluxo_encerrado` passa a conversa a `nenhum`
--      (situação `concluido`, motivo `fluxo_terminou`) pela porta única, e, se
--      o cliente falou depois da última fala da empresa e ninguém respondeu,
--      despacha o turno na MESMA transação — o coordenador decide quem responde
--      na hora, em vez de esperar o cliente insistir. Sem pendência, só libera.
--      O fluxo que terminou com `crm.handoff_to_agent` já pediu o turno: aqui
--      não se pede de novo (seriam dois turnos para a mesma mensagem).
--
--   2. FLUXO QUE PERDEU A CONVERSA SEGUIA FALANDO. O motor de fluxos nunca
--      consultava o coordenador antes de enviar: uma interrupção por regra, uma
--      pessoa que assumiu ou um agente que recebeu a conversa não calavam a
--      execução antiga — duas vozes, exatamente o que o coordenador existe para
--      impedir. `fn_coord_fluxo_pode_falar` responde isso para o envio do fluxo.
--      Só barra execução que JÁ FOI dona (há transição aplicada para ela) e não
--      é mais: fluxo que o coordenador nunca conduziu segue como antes.
--
-- Trigger não faz HTTP: só escreve linhas (estado, diário, event_log).
-- Idempotente: create or replace, create index if not exists, drop trigger if exists.

-- ---------------------------------------------------------------------------
-- Índice: achar o estado pela execução dona (o trigger roda a cada término)
-- ---------------------------------------------------------------------------
create index if not exists idx_coord_estado_execucao_dona
  on public.coord_estado_conversa (organization_id, dono_execution_id)
  where dono_execution_id is not null;

-- ---------------------------------------------------------------------------
-- 1. fn_coord_liberar_fluxo_encerrado
-- ---------------------------------------------------------------------------
create or replace function public.fn_coord_liberar_fluxo_encerrado(
  p_org uuid,
  p_conversa uuid,
  p_execucao uuid
) returns jsonb
  language plpgsql
  set search_path to 'public', 'pg_temp'
as $$
declare
  v_estado public.coord_estado_conversa%rowtype;
  v_status text;
  v_conversa record;
  v_mensagem uuid;
  v_ja_pediu boolean;
  v_despacho jsonb;
begin
  select * into v_estado from public.coord_estado_conversa
   where organization_id = p_org and conversation_id = p_conversa
   for update;
  -- Só a execução que AINDA é a dona. Se a conversa já mudou de mão (chamada
  -- que voltou ao agente, pessoa, interrupção), não há o que liberar.
  if not found or v_estado.dono_tipo <> 'fluxo' or v_estado.dono_execution_id is distinct from p_execucao then
    return jsonb_build_object('ok', false, 'motivo', 'nao_e_o_dono');
  end if;

  select status into v_status from public.flow_executions
   where organization_id = p_org and id = p_execucao;
  if v_status in ('pending', 'running', 'waiting') then
    return jsonb_build_object('ok', false, 'motivo', 'fluxo_vivo');
  end if;

  select id, contact_id, channel_session_id into v_conversa
    from public.conversations
   where organization_id = p_org and id = p_conversa;

  -- O cliente falou depois da última fala da empresa e ninguém respondeu: a
  -- resposta à última pergunta do fluxo, ou algo dito enquanto ele terminava.
  -- Mesmo recorte do lote de `lib/coordenador/entrada.ts`.
  select m.id into v_mensagem
    from public.messages m
   where m.organization_id = p_org and m.conversation_id = p_conversa
     and m.direction = 'inbound'
     and m.created_at > now() - interval '2 days'
     and m.sent_at > coalesce((
           select max(o.sent_at) from public.messages o
            where o.organization_id = p_org and o.conversation_id = p_conversa
              and o.direction = 'outbound'
         ), '-infinity'::timestamptz)
     and not exists (
       select 1 from public.coord_admissoes a
        where a.organization_id = m.organization_id and a.message_id = m.id
     )
   order by m.sent_at desc, m.created_at desc, m.id desc
   limit 1;

  -- `crm.handoff_to_agent` já pediu o turno (com `entregue_por_fluxo`).
  select exists (
    select 1 from public.event_log e
     where e.organization_id = p_org
       and e.event_type = 'ai_agent.dispatch_requested'
       and e.created_at > now() - interval '1 day'
       and e.payload ->> 'entregue_por_fluxo' = p_execucao::text
  ) into v_ja_pediu;

  v_despacho := case
    when v_mensagem is null or v_ja_pediu or v_conversa.channel_session_id is null then null
    else jsonb_build_object(
      'event_type', 'ai_agent.dispatch_requested',
      'payload', jsonb_build_object(
        'conversation_id', p_conversa,
        'contact_id', v_conversa.contact_id,
        'channel_session_id', v_conversa.channel_session_id,
        'inbound_message_id', v_mensagem,
        'imediato', true))
  end;

  return public.fn_coord_transicionar(
    p_org, p_conversa, v_estado.versao,
    'nenhum', null, null, null, null,
    'concluido', 'retorno', 'fluxo_terminou',
    v_estado.politica_versao_id, v_mensagem, null,
    v_despacho,
    jsonb_build_object('execution_id', p_execucao, 'desfecho', v_status,
                       'turno_pedido', v_despacho is not null));
end $$;

revoke execute on function public.fn_coord_liberar_fluxo_encerrado(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.fn_coord_liberar_fluxo_encerrado(uuid, uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 2. fn_coord_fluxo_terminou — agora também libera o fluxo DONO
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
  v_dona record;
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

  -- 0237: o fluxo que AINDA é dono (não voltou por chamada) terminou — destino
  -- escolhido pelo coordenador, transferência definitiva ou ativação manual.
  -- A conversa volta à decisão, e o turno é pedido se o cliente espera resposta.
  for v_dona in
    select conversation_id from public.coord_estado_conversa
     where organization_id = new.organization_id
       and dono_tipo = 'fluxo'
       and dono_execution_id = new.id
  loop
    perform public.fn_coord_liberar_fluxo_encerrado(new.organization_id, v_dona.conversation_id, new.id);
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

-- ---------------------------------------------------------------------------
-- 3. fn_coord_fluxo_pode_falar — o envio do fluxo pergunta antes de sair
-- ---------------------------------------------------------------------------
-- Par de `fn_coord_pode_falar` (que é do agente e exige geração). O fluxo não
-- carrega geração: a pergunta é só "esta execução ainda é a dona?".
create or replace function public.fn_coord_fluxo_pode_falar(
  p_org uuid,
  p_conversa uuid,
  p_execucao uuid
) returns jsonb
  language plpgsql stable
  set search_path to 'public', 'pg_temp'
as $$
declare
  v_estado public.coord_estado_conversa%rowtype;
begin
  select * into v_estado from public.coord_estado_conversa
   where organization_id = p_org and conversation_id = p_conversa;
  if not found then
    return jsonb_build_object('pode', true, 'motivo', 'sem_coordenacao');
  end if;
  if v_estado.dono_tipo = 'fluxo' and v_estado.dono_execution_id = p_execucao then
    if v_estado.situacao = 'bloqueado' then
      return jsonb_build_object('pode', false, 'motivo', 'bloqueado');
    end if;
    return jsonb_build_object('pode', true, 'motivo', 'dono_atual');
  end if;
  -- Execução que o coordenador nunca conduziu (gatilho de bastidor, automação):
  -- o comportamento de antes dele, sem mudança de produto.
  if not exists (
    select 1 from public.coord_transicoes t
     where t.organization_id = p_org and t.conversation_id = p_conversa
       and t.para_tipo = 'fluxo' and t.para_id = p_execucao and t.status = 'aplicada'
  ) then
    return jsonb_build_object('pode', true, 'motivo', 'nao_coordenado');
  end if;
  return jsonb_build_object('pode', false, 'motivo',
    case when v_estado.situacao = 'bloqueado' then 'bloqueado'
         when v_estado.dono_tipo = 'pessoa' then 'pessoa_no_comando'
         else 'nao_e_o_dono' end);
end $$;

revoke execute on function public.fn_coord_fluxo_pode_falar(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.fn_coord_fluxo_pode_falar(uuid, uuid, uuid)
  to service_role;

notify pgrst, 'reload schema';
