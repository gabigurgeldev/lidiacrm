/**
 * A FILA INDIANA ANDA — provado contra Postgres de verdade.
 *
 * ═══ Por que este arquivo precisa existir ═══
 *
 * `lib/routing/decide-fila-e-sorteio.test.ts` prova a aritmética de
 * `selectFixedOrder` com um cursor que o teste mesmo escolhe. Isso deixa de
 * fora exatamente a peça que eu não conseguia provar sem banco: a RPC
 * `fn_flow_routing_next_in_order` (migration 0210), que é quem AVANÇA o cursor.
 *
 * A distância entre as duas coisas é o defeito inteiro. Uma RPC que devolvesse
 * sempre `0` — por um `returning` mal escrito, por exemplo — passaria em todo
 * teste de unidade do produto e entregaria TODOS os leads ao primeiro da ordem.
 * A tela mostraria uma fila configurada; o funil teria um vendedor fixo. Nada
 * quebra, ninguém abre chamado.
 *
 * ═══ O que cada caso mede ═══
 *
 *   1. o cursor anda a cada chamada, e dá a volta no fim (o caso central);
 *   2. filas de blocos diferentes são independentes;
 *   3. filas de organizações diferentes não se enxergam;
 *   4. a função não tem seletor livre — ela é `security definer`, e o que a
 *      torna segura é não aceitar nada além da chave que o chamador já tem.
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

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const FLUXO_A = "33333333-3333-4333-8333-333333333333";
const FLUXO_B = "44444444-4444-4444-8444-444444444444";

beforeAll(() => {
  // Fixture mínima: a FK de `flow_routing_cursors` exige organização e fluxo.
  sql(`
    insert into public.organizations (id, slug, legal_name, display_name)
    values ('${ORG_A}', 'org-a-fila', 'Org A LTDA', 'Org A'),
           ('${ORG_B}', 'org-b-fila', 'Org B LTDA', 'Org B')
    on conflict (id) do nothing;

    insert into public.flows (id, organization_id, name, status)
    values ('${FLUXO_A}', '${ORG_A}', 'Fluxo A', 'draft'),
           ('${FLUXO_B}', '${ORG_A}', 'Fluxo B', 'draft')
    on conflict (id) do nothing;
  `);
});

/** Uma chamada à RPC, devolvendo a vez que ela deu. */
function proxima(org: string, fluxo: string, no: string, tamanho: number): number {
  return Number(
    sql(`select public.fn_flow_routing_next_in_order('${org}', '${fluxo}', '${no}', ${tamanho});`),
  );
}

describe("a RPC que dá a vez da fila", () => {
  it("controle: a função existe e é security definer", () => {
    const linha = sql(`
      select p.prosecdef
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'fn_flow_routing_next_in_order';
    `);
    expect(linha, "a função da migration 0210 não está no banco").toBe("t");
  });

  it("⭐ ANDA: chamadas seguidas dão vezes diferentes, e dá a volta", () => {
    // O defeito que este caso barra: uma RPC que devolvesse sempre 0
    // entregaria todos os leads ao primeiro da ordem — fila configurada na
    // tela, vendedor fixo no funil, e nada quebrado para investigar.
    const vezes = [0, 1, 2, 3].map(() => proxima(ORG_A, FLUXO_A, "fila-1", 3));
    expect(vezes).toEqual([0, 1, 2, 0]);
  });

  it("filas de BLOCOS diferentes são independentes", () => {
    // Dois blocos de fila no mesmo fluxo são duas filas. Compartilhar cursor
    // faria uma andar por causa da outra.
    expect(proxima(ORG_A, FLUXO_A, "fila-x", 2)).toBe(0);
    expect(proxima(ORG_A, FLUXO_A, "fila-y", 2)).toBe(0);
    expect(proxima(ORG_A, FLUXO_A, "fila-x", 2)).toBe(1);
    expect(proxima(ORG_A, FLUXO_A, "fila-y", 2)).toBe(1);
  });

  it("filas de FLUXOS diferentes são independentes", () => {
    expect(proxima(ORG_A, FLUXO_A, "mesmo-no", 2)).toBe(0);
    expect(proxima(ORG_A, FLUXO_B, "mesmo-no", 2)).toBe(0);
  });

  it("tamanho inválido não estoura — devolve a primeira posição", () => {
    // Ordem vazia chega aqui quando alguém publica o bloco sem ninguém na fila.
    // Erro de banco nesse caso derrubaria a execução inteira por um config
    // incompleto, que a publicação já deveria ter barrado.
    expect(proxima(ORG_A, FLUXO_A, "fila-vazia", 0)).toBe(0);
  });

  it("⭐ a função não é alcançável por anon nem authenticated", () => {
    // `security definer` em `public` nasce EXPOSTA — a doutrina de migrations
    // (item 9) manda revogar as DUAS origens do EXECUTE. Sem isto, o PostgREST
    // a expõe como RPC alcançável pela anon key, que vai para o browser.
    const quem = sql(`
      select coalesce(string_agg(distinct grantee, ','), '')
        from information_schema.role_routine_grants
       where routine_schema = 'public'
         and routine_name = 'fn_flow_routing_next_in_order'
         and grantee in ('anon', 'authenticated', 'PUBLIC');
    `);
    expect(quem, `a RPC da fila está exposta para: ${quem}`).toBe("");
  });
});

describe("a tabela do cursor", () => {
  it("tem RLS ligada", () => {
    const rls = sql(`
      select c.relrowsecurity
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = 'flow_routing_cursors';
    `);
    expect(rls, "tabela do motor sem RLS é vazamento entre organizações").toBe("t");
  });

  it("⭐ a chave primária é (org, fluxo, bloco) — senão duas orgs dividem cursor", () => {
    const colunas = sql(`
      select string_agg(a.attname, ',' order by array_position(i.indkey, a.attnum))
        from pg_index i
        join pg_class c on c.oid = i.indrelid
        join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = c.oid and a.attnum = any(i.indkey)
       where n.nspname = 'public' and c.relname = 'flow_routing_cursors' and i.indisprimary;
    `);
    expect(colunas).toBe("organization_id,flow_id,node_id");
  });
});
