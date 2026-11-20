-- 0255 · Agente que SÓ SUGERE respostas: fora do atendimento, dentro do Inbox.
--
-- O PEDIDO, de um cliente real. A empresa não quer a IA falando com o cliente,
-- mas quer o "Sugerir resposta" do Inbox — que gera o rascunho com o prompt, o
-- modelo e a chave do agente. Não havia como ter um sem o outro: o rascunho
-- (`generateDraftReply`) procura o agente PUBLICADO no número, e publicado é
-- exatamente o que atende. Pausar desligava as duas coisas; o dono republicava
-- para recuperar a sugestão e o agente voltava a responder no WhatsApp.
--
-- POR QUE O AGENTE FICA FORA DO AR, E NÃO "NO AR COM UMA TRAVA". Há pelo menos
-- sete portas por onde a IA fala com o cliente — turno de entrada, roteador
-- (membros e fallback), coordenador, follow-up automático, operador, o portão
-- do drain e o picker de atribuição — e todas decidem "este agente atende?"
-- pelo mesmo predicado: `ai_agents.published_version_id` apontando para uma
-- versão `published`. Uma trava nova exigiria um filtro novo em cada uma, e a
-- porta esquecida é o agente falando com o cliente de uma empresa que pediu
-- que ele não falasse. Então o modo "só sugere" é, para o motor, um agente
-- PAUSADO — semântica que já existe, foi medida e é vigiada
-- (`tests/unit/agente-pausado-nao-atende.test.ts`). O que muda é só quem lê a
-- flag: o rascunho do Inbox, que passa a aceitar esse agente.
--
-- QUAL VERSÃO A SUGESTÃO USA. Calculada, não guardada (DIRC): a última versão
-- que esteve no ar — `superseded` com `published_at` preenchido, a mais
-- recentemente retirada. É a MESMA regra que `despausarAgente` usa para
-- escolher o que volta ao ar, então "voltar a atender" devolve exatamente o
-- agente que estava sugerindo.
--
-- O CHECK `ai_agents_so_sugestao_fora_do_ar_check` é a cerca: com a flag
-- ligada, `published_version_id` tem de ser nulo. Um caminho de publicação que
-- não conheça o modo FALHA em vez de pôr o agente no ar em silêncio. Os
-- caminhos conhecidos (editor, API, reverter, proposta aplicada, despausar)
-- passam todos por `publishAgentVersion` (lib/ai/agents/publish.ts), que chama
-- a função abaixo quando o agente está no modo.
--
-- Nenhuma linha existente viola o CHECK: a coluna nasce `false` em todas.
-- Idempotente: `add column if not exists`, CHECK condicionado ao catálogo,
-- `create or replace function`.

alter table public.ai_agents
  add column if not exists so_sugestao boolean not null default false;

comment on column public.ai_agents.so_sugestao is
  'Agente fora do atendimento que segue servindo o "Sugerir resposta" do Inbox (migration 0255). Ligado => published_version_id nulo (CHECK). A versão usada é a última que esteve no ar.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'ai_agents_so_sugestao_fora_do_ar_check'
       and conrelid = 'public.ai_agents'::regclass
  ) then
    alter table public.ai_agents
      add constraint ai_agents_so_sugestao_fora_do_ar_check
      check (not so_sugestao or published_version_id is null);
  end if;
end $$;

-- Publica uma versão e decide, NA MESMA TRANSAÇÃO, se ela fica no ar ou só
-- servindo sugestões. Atômica de propósito: publicar e retirar em duas chamadas
-- deixaria uma janela em que o agente está no ar — e uma mensagem que chegasse
-- nela abriria um turno de atendimento.
--
-- Toda a validação (credencial, número conectado, modelo existente, estado da
-- versão) é a de `fn_publish_ai_agent_version`, chamada aqui dentro — não há
-- segunda régua. Quando a versão pedida JÁ está no ar (ligar o modo a partir de
-- "atendendo"), não há o que publicar: só se retira.
create or replace function public.fn_publicar_versao_do_agente(
  p_org_id uuid,
  p_agent_id uuid,
  p_version_id uuid,
  p_so_sugestao boolean
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
  v_prev uuid;
  v_published_at timestamptz;
  v_agora timestamptz := now();
begin
  select a.id, a.organization_id, a.published_version_id, a.archived_at
    into v_agent
    from public.ai_agents a
   where a.id = p_agent_id
   for update;

  if not found or v_agent.organization_id <> p_org_id then
    raise exception 'agent_not_found' using errcode = 'P0001';
  end if;
  if v_agent.archived_at is not null then
    raise exception 'agent_archived' using errcode = 'P0001';
  end if;

  if p_version_id is not null and v_agent.published_version_id is not distinct from p_version_id then
    v_prev := v_agent.published_version_id;
    v_published_at := v_agora;
  else
    -- O CHECK proíbe flag ligada com versão no ar: desliga antes de publicar e
    -- religa depois, se for o caso. Tudo dentro desta transação — ninguém de
    -- fora enxerga o meio.
    update public.ai_agents a
       set so_sugestao = false
     where a.id = p_agent_id;

    select r.previous_version_id, r.published_at
      into v_prev, v_published_at
      from public.fn_publish_ai_agent_version(p_org_id, p_agent_id, p_version_id) r;
  end if;

  if p_so_sugestao then
    update public.ai_agent_versions v
       set status = 'superseded',
           superseded_at = v_agora
     where v.id = p_version_id
       and v.status = 'published';

    update public.ai_agents a
       set published_version_id = null,
           so_sugestao = true,
           updated_at = v_agora
     where a.id = p_agent_id;
  else
    update public.ai_agents a
       set so_sugestao = false,
           updated_at = v_agora
     where a.id = p_agent_id;
  end if;

  return query
    select p_agent_id, p_version_id, v_prev, v_published_at;
end;
$$;

comment on function public.fn_publicar_versao_do_agente(uuid, uuid, uuid, boolean) is
  'Publica a versão (validação de fn_publish_ai_agent_version) e, se p_so_sugestao, a retira do ar na mesma transação e liga ai_agents.so_sugestao (migration 0255). Chamador: lib/ai/agents/publish.ts.';

-- Item 9 da doutrina: as duas origens de EXECUTE. Só o service_role publica.
revoke execute on function public.fn_publicar_versao_do_agente(uuid, uuid, uuid, boolean) from public, anon;
revoke execute on function public.fn_publicar_versao_do_agente(uuid, uuid, uuid, boolean) from authenticated;
grant execute on function public.fn_publicar_versao_do_agente(uuid, uuid, uuid, boolean) to service_role;

notify pgrst, 'reload schema';
