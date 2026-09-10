/**
 * O PLACAR DA DIVISÃO DE CAMINHOS COMPENSA — provado contra Postgres de verdade.
 *
 * ═══ Por que este arquivo precisa existir ═══
 *
 * `lib/flow-engine/divisao.test.ts` prova `escolherPorPlacar` com um placar que
 * o próprio teste escreve, e `nodes/divisao-de-caminho.test.ts` prova o bloco
 * sobre um falso em memória. Nenhum dos dois toca a peça que decide de verdade
 * em produção: a RPC `fn_flow_split_least_used` (migration 0215), que ESCOLHE E
 * CONTA numa transação só.
 *
 * A distância entre as duas coisas é o defeito inteiro. Uma RPC que devolvesse
 * sempre o mesmo ramo — por um `order by` no lugar errado, por um `update` que
 * não conta — passaria em todo teste de unidade e mandaria 100% do tráfego por
 * um caminho. A tela mostraria três caminhos configurados; o funil teria um. O
 * fluxo termina "concluído" em todos os casos, e ninguém abre chamado.
 *
 * ═══ O que cada caso mede ═══
 *
 *   1. o placar EMPATA ao longo de várias chamadas (o caso central);
 *   2. um ramo acrescentado depois é compensado — a promessa do modo;
 *   3. ramo removido da config some do placar e para de pesar;
 *   4. placares de blocos e de organizações diferentes são independentes;
 *   5. a função é `security definer` e não é alcançável por anon/authenticated.
 */
import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";

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

/**
 * Uma contagem como o USUÁRIO, pelo mesmo caminho da produção. Conectar como
 * `postgres` mediria nada (`rolbypassrls = t`) — entre o tenant A e a linha do
 * tenant B existe só a policy.
 */
function countAs(userId: string, countQuery: string): number {
  const out = sql(`
    set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
    ${countQuery}
  `);
  const linhas = out.split("\n");
  const ultima = linhas[linhas.length - 1];
  if (ultima === undefined || !/^\d+$/.test(ultima)) {
    throw new Error(`saída inesperada do psql: ${out}`);
  }
  return Number(ultima);
}

const ORG_A = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb";
const FLUXO_A = "cccccccc-0000-4000-8000-cccccccccccc";
const FLUXO_B = "dddddddd-0000-4000-8000-dddddddddddd";
const FLUXO_DE_B = "dddddddd-0000-4000-8000-ddddddddddde";
const MANAGER_A = "eeeeeeee-0000-4000-8000-eeeeeeeeeee1";
const AGENTE_A = "eeeeeeee-0000-4000-8000-eeeeeeeeeee2";
const MANAGER_B = "eeeeeeee-0000-4000-8000-eeeeeeeeeee3";

beforeAll(() => {
  // Fixture mínima: a FK de `flow_split_counters` exige organização e fluxo.
  sql(`
    insert into public.organizations (id, slug, legal_name, display_name)
    values ('${ORG_A}', 'org-a-divisao', 'Org A LTDA', 'Org A'),
           ('${ORG_B}', 'org-b-divisao', 'Org B LTDA', 'Org B')
    on conflict (id) do nothing;

    insert into public.flows (id, organization_id, name, status)
    values ('${FLUXO_A}', '${ORG_A}', 'Fluxo A da divisao', 'draft'),
           ('${FLUXO_B}', '${ORG_A}', 'Fluxo B da divisao', 'draft'),
           ('${FLUXO_DE_B}', '${ORG_B}', 'Fluxo da org B', 'draft')
    on conflict (id) do nothing;

    insert into auth.users (id, email) values
      ('${MANAGER_A}', 'divisao-mgr-a@invariant.test'),
      ('${AGENTE_A}',  'divisao-agent-a@invariant.test'),
      ('${MANAGER_B}', 'divisao-mgr-b@invariant.test')
      on conflict (id) do nothing;

    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${MANAGER_A}', '${ORG_A}', 'manager', now()),
      ('${AGENTE_A}',  '${ORG_A}', 'agent',   now()),
      ('${MANAGER_B}', '${ORG_B}', 'manager', now())
      on conflict do nothing;
  `);

  // Uma linha de placar em cada organização, para as contagens abaixo terem o
  // que contar dos DOIS lados. Vem pela RPC de propósito: é o caminho real.
  proximo(ORG_A, FLUXO_A, "rls-divide", ["a", "b"]);
  proximo(ORG_B, FLUXO_DE_B, "rls-divide", ["a", "b"]);
});

/** Uma chamada à RPC, devolvendo o ramo escolhido. */
function proximo(org: string, fluxo: string, no: string, ramos: string[]): string {
  const lista = ramos.map((r) => `'${r}'`).join(",");
  return sql(
    `select public.fn_flow_split_least_used('${org}', '${fluxo}', '${no}', array[${lista}]::text[]);`,
  );
}

/** O placar guardado, como texto ordenado — a evidência de que a conta é real. */
function placar(org: string, fluxo: string, no: string): string {
  return sql(`
    select coalesce(string_agg(branch_id || '=' || contagem, ',' order by branch_id), '')
      from public.flow_split_counters
     where organization_id = '${org}' and flow_id = '${fluxo}' and node_id = '${no}';
  `);
}

describe("a RPC que escolhe o caminho menos usado", () => {
  it("controle: a função existe e é security definer", () => {
    const linha = sql(`
      select p.prosecdef
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'fn_flow_split_least_used';
    `);
    expect(linha, "a função da migration 0215 não está no banco").toBe("t");
  });

  it("⭐ EMPATA: seis chamadas em três caminhos dão duas para cada", () => {
    // O defeito que este caso barra: uma RPC que devolvesse sempre o mesmo ramo
    // mandaria 100% do tráfego por um caminho, com três desenhados na tela.
    const escolhas = [0, 1, 2, 3, 4, 5].map(() =>
      proximo(ORG_A, FLUXO_A, "divide-1", ["a", "b", "c"]),
    );

    const contagem = (r: string) => escolhas.filter((e) => e === r).length;
    expect(contagem("a"), `distribuição torta: ${escolhas.join(",")}`).toBe(2);
    expect(contagem("b")).toBe(2);
    expect(contagem("c")).toBe(2);
    expect(placar(ORG_A, FLUXO_A, "divide-1")).toBe("a=2,b=2,c=2");
  });

  it("⭐ COMPENSA: caminho acrescentado depois absorve até alcançar", () => {
    // A promessa inteira do modo igualitário, e a única coisa que o distingue
    // da fila. Sem ela, "igualitário" seria só um sinônimo mais caro.
    for (let i = 0; i < 4; i += 1) proximo(ORG_A, FLUXO_A, "divide-2", ["a", "b"]);
    expect(placar(ORG_A, FLUXO_A, "divide-2")).toBe("a=2,b=2");

    // Entra o terceiro. As duas próximas têm de ir TODAS para ele.
    const depois = [proximo(ORG_A, FLUXO_A, "divide-2", ["a", "b", "c"]),
                    proximo(ORG_A, FLUXO_A, "divide-2", ["a", "b", "c"])];
    expect(depois).toEqual(["c", "c"]);
    expect(placar(ORG_A, FLUXO_A, "divide-2")).toBe("a=2,b=2,c=2");
  });

  it("⭐ ramo REMOVIDO da config some do placar", () => {
    // Saída apagada no editor não pode continuar pesando: o bloco ficaria
    // perseguindo o atraso de um caminho que já não existe.
    proximo(ORG_A, FLUXO_A, "divide-3", ["a", "b"]);
    proximo(ORG_A, FLUXO_A, "divide-3", ["a", "b"]);
    expect(placar(ORG_A, FLUXO_A, "divide-3")).toBe("a=1,b=1");

    proximo(ORG_A, FLUXO_A, "divide-3", ["a"]);
    expect(placar(ORG_A, FLUXO_A, "divide-3"), "o ramo b devia ter sumido").toBe("a=2");
  });

  it("placares de BLOCOS diferentes são independentes", () => {
    expect(proximo(ORG_A, FLUXO_A, "divide-x", ["a", "b"])).toBe("a");
    expect(proximo(ORG_A, FLUXO_A, "divide-y", ["a", "b"])).toBe("a");
    expect(proximo(ORG_A, FLUXO_A, "divide-x", ["a", "b"])).toBe("b");
    expect(proximo(ORG_A, FLUXO_A, "divide-y", ["a", "b"])).toBe("b");
  });

  it("placares de FLUXOS diferentes são independentes", () => {
    expect(proximo(ORG_A, FLUXO_A, "mesmo-no", ["a", "b"])).toBe("a");
    expect(proximo(ORG_A, FLUXO_B, "mesmo-no", ["a", "b"])).toBe("a");
  });

  it("lista vazia não estoura — devolve nada em vez de derrubar a execução", () => {
    expect(sql(
      `select coalesce(public.fn_flow_split_least_used('${ORG_A}', '${FLUXO_A}', 'vazio', array[]::text[]), 'nulo');`,
    )).toBe("nulo");
  });

  it("⭐ a função não é alcançável por anon nem authenticated", () => {
    // `security definer` em `public` nasce EXPOSTA — a doutrina de migrations
    // (item 9) manda revogar as DUAS origens do EXECUTE.
    const quem = sql(`
      select coalesce(string_agg(distinct grantee, ','), '')
        from information_schema.role_routine_grants
       where routine_schema = 'public'
         and routine_name = 'fn_flow_split_least_used'
         and grantee in ('anon', 'authenticated', 'PUBLIC');
    `);
    expect(quem, `a RPC do placar está exposta para: ${quem}`).toBe("");
  });
});

describe("a tabela do placar", () => {
  it("tem RLS ligada", () => {
    const rls = sql(`
      select c.relrowsecurity
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = 'flow_split_counters';
    `);
    expect(rls, "tabela do motor sem RLS é vazamento entre organizações").toBe("t");
  });

  it("⭐ o manager da org A lê as linhas da PRÓPRIA org (controle positivo)", () => {
    // Sem este caso, uma policy que negasse TUDO passaria no teste de
    // isolamento abaixo — zero linhas do vizinho é o que ela devolveria também.
    const proprias = countAs(
      MANAGER_A,
      `select count(*) from public.flow_split_counters where organization_id = '${ORG_A}';`,
    );
    expect(proprias).toBeGreaterThan(0);
  });

  it("⭐ o manager da org A lê ZERO linhas da org B", () => {
    const vizinha = countAs(
      MANAGER_A,
      `select count(*) from public.flow_split_counters where organization_id = '${ORG_B}';`,
    );
    expect(vizinha).toBe(0);
  });

  it("⭐ pedindo a tabela INTEIRA, o manager da org A só alcança as dele", () => {
    // Sem filtro de organização: é assim que um cliente do PostgREST pediria a
    // tabela toda, e é o pedido que uma policy frouxa atende por inteiro.
    const total = countAs(MANAGER_A, `select count(*) from public.flow_split_counters;`);
    const proprias = countAs(
      MANAGER_A,
      `select count(*) from public.flow_split_counters where organization_id = '${ORG_A}';`,
    );
    expect(total).toBe(proprias);
  });

  it("⭐ o `agent` da própria organização NÃO lê o placar", () => {
    // A policy exige `manager`, como a das demais tabelas do motor (0205/0207).
    // Sem este caso, afrouxar o papel passaria despercebido.
    const doAgente = countAs(
      AGENTE_A,
      `select count(*) from public.flow_split_counters where organization_id = '${ORG_A}';`,
    );
    expect(doAgente).toBe(0);
  });

  it("⭐ a chave primária é (org, fluxo, bloco, ramo)", () => {
    const colunas = sql(`
      select string_agg(a.attname, ',' order by array_position(i.indkey, a.attnum))
        from pg_index i
        join pg_class c on c.oid = i.indrelid
        join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = c.oid and a.attnum = any(i.indkey)
       where n.nspname = 'public' and c.relname = 'flow_split_counters' and i.indisprimary;
    `);
    expect(colunas).toBe("organization_id,flow_id,node_id,branch_id");
  });
});
