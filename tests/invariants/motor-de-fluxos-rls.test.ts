import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * O MOTOR DE FLUXOS NÃO VAZA ENTRE ORGANIZAÇÕES — NEM PARA O `agent` DE DENTRO.
 *
 * ═══ Por que um arquivo próprio, e não três linhas em rls-isolation.test.ts ═══
 *
 * Foi exatamente o que tentei primeiro, e o teste reprovou por ACERTO. Aquele
 * molde semeia um usuário `agent` por organização e prova duas coisas por
 * tabela: zero linhas do vizinho, e mais de zero linhas próprias. As policies
 * destas três exigem `manager` (a 0207 espelhou a 0205, não a 0203), então o
 * controle positivo dava zero — e a "correção" natural seria afrouxar a policy
 * para caber no molde, que é o defeito de trás para frente.
 *
 * Mesmo motivo pelo qual `webhook_lead_captures` tem o arquivo dela.
 *
 * ═══ O que está em jogo nestas três tabelas ═══
 *
 * `flow_executions.input` guarda o PAYLOAD DO EVENTO que armou a execução: num
 * gatilho de "mensagem recebida", é a mensagem inteira que a pessoa escreveu.
 * `context` guarda o que os blocos anotaram sobre ela pelo caminho, e
 * `flow_execution_frames.vars` guarda o mesmo por ramo paralelo. Não é metadado
 * de automação — é conversa de cliente, em texto puro, numa tabela que ninguém
 * abre para conferir.
 *
 * Entre o tenant A e a frase do cliente do tenant B existe só a policy. Conectar
 * como `postgres` mediria NADA (`rolbypassrls = t`): aqui é `set role
 * authenticated` + `request.jwt.claims`, o mesmo caminho que a produção usa.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error(
    "TEST_DB_CONTAINER not set — rode esta suíte via `pnpm test:db` (scripts/test-db.sh)",
  );
}
const containerName: string = container;

function sql(script: string): string {
  return execFileSync(
    "docker",
    [
      "exec", "-i", containerName, "psql", "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-tA", "-f", "-",
    ],
    { input: script, encoding: "utf8" },
  ).trim();
}

function countAs(userId: string, countQuery: string): number {
  const out = sql(`
    set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
    ${countQuery}
  `);
  const lines = out.split("\n");
  const last = lines[lines.length - 1];
  if (last === undefined || !/^\d+$/.test(last)) {
    throw new Error(`saída inesperada do psql: ${out}`);
  }
  return Number(last);
}

// UUIDs próprios: os arquivos de invariante compartilham a base, e disputar as
// mesmas linhas faria um passar por causa do seed do outro.
const ORG_A = "cccccccc-0000-4000-8000-0000000000f1";
const ORG_B = "cccccccc-0000-4000-8000-0000000000f2";
const MANAGER_A = "cccccccc-1111-4000-8000-0000000000f1";
const AGENT_A = "cccccccc-1111-4000-8000-0000000000f3";
const MANAGER_B = "cccccccc-1111-4000-8000-0000000000f2";

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${MANAGER_A}', 'fluxo-mgr-a@invariant.test'),
      ('${AGENT_A}',   'fluxo-agent-a@invariant.test'),
      ('${MANAGER_B}', 'fluxo-mgr-b@invariant.test')
      on conflict (id) do nothing;

    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'fluxo-inv-a', 'Fluxo Invariant A', 'Fluxo A'),
      ('${ORG_B}', 'fluxo-inv-b', 'Fluxo Invariant B', 'Fluxo B')
      on conflict (id) do nothing;

    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${MANAGER_A}', '${ORG_A}', 'manager', now()),
      ('${AGENT_A}',   '${ORG_A}', 'agent',   now()),
      ('${MANAGER_B}', '${ORG_B}', 'manager', now())
      on conflict do nothing;

    do $seed$
    declare
      v_org uuid;
      v_flow uuid;
      v_versao uuid;
      v_exec uuid;
    begin
      foreach v_org in array array['${ORG_A}'::uuid, '${ORG_B}'::uuid] loop
        select id into v_flow from public.flows
          where organization_id = v_org and name = 'Fluxo do invariante' limit 1;
        if v_flow is null then
          insert into public.flows (organization_id, name, status)
            values (v_org, 'Fluxo do invariante', 'draft') returning id into v_flow;
        end if;

        select id into v_versao from public.flow_versions
          where organization_id = v_org and flow_id = v_flow limit 1;
        if v_versao is null then
          insert into public.flow_versions
            (organization_id, flow_id, version_number, graph, trigger_config)
            values (v_org, v_flow, 1, '{"nodes":[],"edges":[]}'::jsonb, '{"kind":"manual"}'::jsonb)
            returning id into v_versao;
        end if;

        select id into v_exec from public.flow_executions
          where organization_id = v_org limit 1;
        if v_exec is null then
          -- O input carrega texto de cliente de mentira, que é o que a policy
          -- protege de verdade.
          insert into public.flow_executions
            (organization_id, flow_id, version_id, current_node_id, next_eval_at, input)
            values (v_org, v_flow, v_versao, 'inicio', now(),
                    jsonb_build_object('texto', 'frase privada de ' || v_org::text))
            returning id into v_exec;
        end if;

        if not exists (select 1 from public.flow_execution_frames where organization_id = v_org) then
          insert into public.flow_execution_frames
            (organization_id, execution_id, node_id, status, next_eval_at, vars)
            values (v_org, v_exec, 'inicio', 'ready', now(),
                    jsonb_build_object('segredo', 'var local de ' || v_org::text));
        end if;

        if not exists (select 1 from public.flow_execution_joins where organization_id = v_org) then
          insert into public.flow_execution_joins
            (organization_id, execution_id, fork_node_id, join_node_id, modo, esperadas)
            values (v_org, v_exec, 'bifurca', 'junta', 'todas', 2);
        end if;
      end loop;
    end
    $seed$;
  `);
});

const TABELAS = [
  "flow_executions",
  "flow_execution_frames",
  "flow_execution_joins",
] as const;

describe("motor de fluxos — isolamento entre organizações e gate de papel", () => {
  for (const tabela of TABELAS) {
    it(`o manager da org A lê as linhas da PRÓPRIA org em ${tabela} (controle positivo)`, () => {
      // Sem este caso, uma policy que negasse TUDO passaria no teste de
      // isolamento — zero linhas do vizinho é o que ela devolveria também.
      const proprias = countAs(
        MANAGER_A,
        `select count(*) from public.${tabela} where organization_id = '${ORG_A}';`,
      );
      expect(proprias).toBeGreaterThan(0);
    });

    it(`o manager da org A lê ZERO linhas da org B em ${tabela}`, () => {
      const vizinha = countAs(
        MANAGER_A,
        `select count(*) from public.${tabela} where organization_id = '${ORG_B}';`,
      );
      expect(vizinha).toBe(0);
    });

    it(`pedindo ${tabela} INTEIRA, o manager da org A só alcança as dele`, () => {
      // Sem filtro de organização: é assim que um cliente do PostgREST pediria a
      // tabela toda, e é o pedido que uma policy frouxa atende por inteiro.
      const total = countAs(MANAGER_A, `select count(*) from public.${tabela};`);
      const proprias = countAs(
        MANAGER_A,
        `select count(*) from public.${tabela} where organization_id = '${ORG_A}';`,
      );
      expect(total).toBe(proprias);
    });

    it(`o AGENT da própria org não lê ${tabela} — a policy exige manager`, () => {
      // É o caso que distingue estas tabelas do padrão org-flat do resto do
      // repo, e é ele que reprova se alguém "simplificar" a policy. O `agent`
      // atende clientes; ele não precisa do histórico de execução de automação,
      // e esse histórico carrega a frase de clientes que não são dele.
      const doAgente = countAs(
        AGENT_A,
        `select count(*) from public.${tabela} where organization_id = '${ORG_A}';`,
      );
      expect(doAgente).toBe(0);
    });

    it(`o manager da org B lê os dele em ${tabela} (controle positivo do outro lado)`, () => {
      const proprias = countAs(
        MANAGER_B,
        `select count(*) from public.${tabela} where organization_id = '${ORG_B}';`,
      );
      expect(proprias).toBeGreaterThan(0);
    });
  }

  it("a sessão de um tenant não ESCREVE frente na execução do outro", () => {
    // O caminho de escrita real é o worker, com service role, que bypassa RLS.
    // Uma sessão que conseguisse inserir aqui plantaria um ramo de execução no
    // fluxo de outra empresa — e o motor o executaria como se fosse legítimo.
    //
    // A prova é por CONTAGEM e não por capturar a mensagem do erro: `raise` sai
    // em stderr, e o `execFileSync` acima lê só stdout — um teste que espera a
    // mensagem passa a impressão de medir e não mede.
    sql(`
      set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${MANAGER_A}"}', false);
      do $$
      declare v_exec_b uuid;
      begin
        select id into v_exec_b from public.flow_executions
          where organization_id = '${ORG_B}' limit 1;
        insert into public.flow_execution_frames
          (organization_id, execution_id, node_id, status, next_eval_at)
          values ('${ORG_B}', v_exec_b, 'plantado_pelo_vizinho', 'ready', now());
      exception when others then
        null; -- a recusa é o esperado; quem decide é a contagem abaixo
      end
      $$;
    `);

    const plantadas = sql(`
      reset role;
      select count(*) from public.flow_execution_frames
        where node_id = 'plantado_pelo_vizinho';
    `);
    expect(plantadas.split("\n").pop()).toBe("0");
  });
});
