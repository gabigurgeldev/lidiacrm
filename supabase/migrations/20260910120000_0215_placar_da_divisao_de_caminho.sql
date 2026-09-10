-- 0215 — o PLACAR do bloco "Dividir os caminhos" (`logic.split`).
--
-- O bloco reparte as execuções entre as saídas. Dois dos três modos precisam de
-- memória entre execuções:
--
--   • `fila`        — a vez, girando 1,2,3. Reusa `fn_flow_routing_next_in_order`
--                     (migration 0211): o que aquela função guarda é "em que
--                     índice de uma lista de tamanho N este bloco parou", e isso
--                     não sabe nem precisa saber se a lista é de vendedores ou
--                     de arestas. Nada novo aqui para esse modo.
--   • `igualitario` — quantas vezes CADA saída já foi usada, para mandar a
--                     próxima para quem está atrás. É o que esta migration cria.
--
-- Por que não cabia no cursor de 0211: um inteiro por bloco responde "qual é a
-- vez", não "quem está atrás". Sem a contagem por ramo, acrescentar uma saída no
-- meio do mês não teria como ser compensado — e compensar é a única coisa que
-- distingue o modo igualitário da fila.
--
-- A linha é por (org, fluxo, bloco, ramo) pelo mesmo motivo escrito em 0211: o
-- contador não pode morar em `flow_executions.context`, que é POR EXECUÇÃO —
-- cada lead abre uma execução nova, o placar nasceria zerado toda vez e a
-- divisão mandaria tudo pelo primeiro caminho, sem erro nenhum.

create table if not exists public.flow_split_counters (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  flow_id uuid not null references public.flows(id) on delete cascade,
  node_id text not null,
  branch_id text not null,
  contagem bigint not null default 0,
  atualizado_em timestamptz not null default now(),
  primary key (organization_id, flow_id, node_id, branch_id)
);

comment on table public.flow_split_counters is
  'Quantas vezes cada saida de cada bloco logic.split ja foi usada. Fora de flow_executions de proposito: o placar precisa sobreviver entre execucoes, senao a divisao manda tudo pelo primeiro caminho. Espelhado em lib/flow-engine/divisao.ts (escolherPorPlacar).';

alter table public.flow_split_counters enable row level security;

drop policy if exists tenant_isolation_flow_split_counters_all on public.flow_split_counters;
create policy tenant_isolation_flow_split_counters_all on public.flow_split_counters
  for all using (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'manager'))
    or public.fn_is_platform_admin()
  ) with check (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'manager'))
    or public.fn_is_platform_admin()
  );

-- ── Quem está atrás, e já conta o uso ────────────────────────────────────────
--
-- Escolher lendo daqui e gravando depois é corrida: duas execuções no mesmo
-- tique leem o MESMO placar e mandam as duas pelo mesmo caminho — o oposto do
-- que "igualitário" promete, e o desvio aparece exatamente sob carga, que é
-- quando ninguém está olhando.
--
-- `select ... for update` sozinho NÃO resolve este caso. A segunda transação
-- espera o lock e, ao acordar, revalida apenas o `where` da própria subconsulta
-- (igualdade de chave) — o `order by contagem` já foi calculado com o placar
-- velho, e ela reescolhe o mesmo ramo. O lock consultivo por bloco serializa a
-- decisão INTEIRA (ler, escolher, contar), e cai sozinho no fim da transação.
create or replace function public.fn_flow_split_least_used(
  p_organization_id uuid,
  p_flow_id uuid,
  p_node_id text,
  p_ramos text[]
)
returns text
language plpgsql
security definer
set search_path = public
as $placar$
declare
  v_escolhido text;
begin
  if p_ramos is null or array_length(p_ramos, 1) is null then
    return null;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_organization_id::text || '/' || p_flow_id::text || '/' || p_node_id, 0)
  );

  -- O placar acompanha a config: saída removida no editor não pode continuar
  -- pesando na conta, senão o bloco fica mandando tudo para as sobreviventes
  -- "atrasadas" em relação a um caminho que já não existe.
  delete from public.flow_split_counters
   where organization_id = p_organization_id
     and flow_id = p_flow_id
     and node_id = p_node_id
     and not (branch_id = any(p_ramos));

  -- Caminho novo entra com ZERO e absorve as próximas execuções até empatar.
  -- É a feature: quem escolheu "igualitária" pediu que o desequilíbrio seja
  -- compensado, e não que a saída nova comece já atrasada para sempre.
  insert into public.flow_split_counters (organization_id, flow_id, node_id, branch_id, contagem)
  select p_organization_id, p_flow_id, p_node_id, r, 0
    from unnest(p_ramos) as r
  on conflict (organization_id, flow_id, node_id, branch_id) do nothing;

  update public.flow_split_counters c
     set contagem = c.contagem + 1,
         atualizado_em = now()
   where c.organization_id = p_organization_id
     and c.flow_id = p_flow_id
     and c.node_id = p_node_id
     and c.branch_id = (
       select branch_id
         from public.flow_split_counters
        where organization_id = p_organization_id
          and flow_id = p_flow_id
          and node_id = p_node_id
          and branch_id = any(p_ramos)
        -- Desempate por `branch_id`: sem ele, duas execuções idênticas dariam
        -- caminhos diferentes e nenhum teste conseguiria vigiar o modo.
        order by contagem asc, branch_id asc
        limit 1
     )
  returning c.branch_id into v_escolhido;

  return v_escolhido;
end;
$placar$;

-- Função nova em `public` nasce EXPOSTA — as DUAS origens do EXECUTE precisam
-- ser revogadas (doutrina de migrations, item 9).
revoke execute on function public.fn_flow_split_least_used(uuid, uuid, text, text[]) from public, anon, authenticated;
grant execute on function public.fn_flow_split_least_used(uuid, uuid, text, text[]) to service_role;
