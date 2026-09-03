-- 0210 — a vez de cada um na FILA INDIANA.
--
-- O bloco `routing.fixed_order` percorre uma ordem declarada por quem monta o
-- fluxo. Percorrer exige lembrar em quem parou — e esse "onde parou" não pode
-- morar em `flow_executions.context`, que é POR EXECUÇÃO: cada lead abre uma
-- execução nova, o cursor nasceria zerado toda vez, e a "ordem" entregaria
-- sempre ao primeiro da lista. Seria uma fila que nunca anda, sem erro nenhum.
--
-- Por isso a linha é por (org, fluxo, bloco): dois blocos de fila no mesmo
-- fluxo são duas filas independentes, e o mesmo bloco em fluxos diferentes
-- também.
--
-- A função é `security definer` e SEM seletor livre: ela só avança o cursor de
-- uma chave que o chamador já tem, não lê nem escreve linha de outra
-- organização, e o `p_organization_id` vem da linha da execução no motor —
-- nunca do config do bloco.

create table if not exists public.flow_routing_cursors (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  flow_id uuid not null references public.flows(id) on delete cascade,
  node_id text not null,
  posicao integer not null default 0,
  atualizado_em timestamptz not null default now(),
  primary key (organization_id, flow_id, node_id)
);

comment on table public.flow_routing_cursors is
  'Onde a fila indiana de cada bloco routing.fixed_order parou. Fora de flow_executions de proposito: o cursor precisa sobreviver entre execucoes, senao a fila reinicia a cada lead. Espelhado em lib/routing/decide.ts (selectFixedOrder).';

alter table public.flow_routing_cursors enable row level security;

drop policy if exists tenant_isolation_flow_routing_cursors_all on public.flow_routing_cursors;
create policy tenant_isolation_flow_routing_cursors_all on public.flow_routing_cursors
  for all using (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'manager'))
    or public.fn_is_platform_admin()
  ) with check (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'manager'))
    or public.fn_is_platform_admin()
  );

-- ── Avançar a vez, atomicamente ──────────────────────────────────────────────
--
-- Ler o cursor e gravar o próximo em duas idas ao banco é uma corrida: dois
-- leads chegando no mesmo tique leriam a MESMA posição e entregariam ao MESMO
-- vendedor — a fila pararia de andar exatamente quando há movimento, que é
-- quando ninguém está olhando. `insert ... on conflict do update ... returning`
-- resolve numa declaração só, sob o lock da linha.
--
-- Devolve a posição ANTERIOR (de onde o chamador deve procurar) e já deixa o
-- cursor no próximo. Quem chama decide quem é elegível — o banco não sabe disso.
create or replace function public.fn_flow_routing_next_in_order(
  p_organization_id uuid,
  p_flow_id uuid,
  p_node_id text,
  p_tamanho integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $fila$
declare
  v_anterior integer;
begin
  if p_tamanho is null or p_tamanho < 1 then
    return 0;
  end if;

  -- Garante a linha. `do nothing` porque duas chamadas simultâneas na primeira
  -- vez são normais, e a segunda não deve falhar nem zerar a primeira.
  insert into public.flow_routing_cursors (organization_id, flow_id, node_id, posicao)
  values (p_organization_id, p_flow_id, p_node_id, 0)
  on conflict (organization_id, flow_id, node_id) do nothing;

  -- Ler e gravar em declarações separadas seria corrida: dois leads no mesmo
  -- tique leriam a MESMA posição e entregariam ao MESMO vendedor — a fila
  -- pararia de andar exatamente quando há movimento. Um `update ... returning`
  -- resolve sob o lock da linha, e devolve a posição ANTERIOR (a vez de agora),
  -- já deixando o cursor no próximo.
  update public.flow_routing_cursors
     set posicao = (posicao + 1) % p_tamanho,
         atualizado_em = now()
   where organization_id = p_organization_id
     and flow_id = p_flow_id
     and node_id = p_node_id
  returning (posicao - 1 + p_tamanho) % p_tamanho
    into v_anterior;

  return coalesce(v_anterior, 0);
end;
$fila$;

-- Função nova em `public` nasce EXPOSTA — as DUAS origens do EXECUTE precisam
-- ser revogadas (doutrina de migrations, item 9).
revoke execute on function public.fn_flow_routing_next_in_order(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.fn_flow_routing_next_in_order(uuid, uuid, text, integer) to service_role;
