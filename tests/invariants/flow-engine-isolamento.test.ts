import { beforeAll, describe, expect, it } from "vitest";

import { sql, countAs, writeCountAs } from "./gov-helpers";

/**
 * FLOW ENGINE — ISOLAMENTO ENTRE DUAS ORGANIZAÇÕES.
 *
 * As quatro tabelas (`flows`, `flow_versions`, `flow_executions`,
 * `flow_execution_events`) nasceram na 0203 sem nenhuma prova comportamental
 * — `tests/invariants/rls-completude-varredura.test.ts` pegou o buraco no
 * primeiro CI que rodou 0203+0204 juntas contra um Postgres real. Este
 * arquivo é a prova, e a 0205 (forward-fix) é o motivo dela existir: a
 * policy nasceu ALL-só-tenancy, sem `fn_role_at_least` — qualquer papel do
 * tenant conseguia criar e apagar fluxo pelo PostgREST direto.
 *
 * ═══ O que se mede ═══
 *
 *   1. LEITURA: usuário da org A conta ZERO linhas de fluxo, versão, execução
 *      e evento de execução da org B.
 *   2. ESCRITA: `update`/`delete` da org A sobre linha da org B afetam ZERO
 *      linhas.
 *   3. INSERT com `organization_id` alheio é barrado pelo `with check`.
 *   4. `fn_claim_due_flow_executions` NÃO é executável por `authenticated`
 *      nem por `anon` — ela devolve linhas de TODAS as organizações por
 *      desenho (é o claim do worker), e só `service_role` pode chamá-la.
 *
 * Sem PII: nomes sintéticos.
 */

const ORG_A = "eeeeeeee-0000-4000-8000-00000000000a";
const ORG_B = "eeeeeeee-0000-4000-8000-00000000000b";
const USER_A = "eeeeeeee-1111-4000-8000-00000000000a";
const USER_B = "eeeeeeee-1111-4000-8000-00000000000b";
const FLOW_A = "eeeeeeee-2222-4000-8000-00000000000a";
const FLOW_B = "eeeeeeee-2222-4000-8000-00000000000b";
const VERSION_A = "eeeeeeee-3333-4000-8000-00000000000a";
const VERSION_B = "eeeeeeee-3333-4000-8000-00000000000b";
const EXECUTION_A = "eeeeeeee-4444-4000-8000-00000000000a";
const EXECUTION_B = "eeeeeeee-4444-4000-8000-00000000000b";
const EVENT_A = "eeeeeeee-5555-4000-8000-00000000000a";
const EVENT_B = "eeeeeeee-5555-4000-8000-00000000000b";

function semear(
  org: string,
  user: string,
  flow: string,
  version: string,
  execution: string,
  event: string,
  tag: string,
): string {
  return `
    insert into auth.users (id, email) values ('${user}', 'flow-inv-${tag}@invariant.test')
      on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${org}', 'flow-inv-${tag}', 'Flow Invariant ${tag}', 'Flow ${tag}')
      on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${user}', '${org}', 'manager', now())
      on conflict do nothing;
    insert into public.flows (id, organization_id, name, status)
      values ('${flow}', '${org}', 'Flow Invariant ${tag}', 'draft')
      on conflict (id) do nothing;
    insert into public.flow_versions
      (id, organization_id, flow_id, version_number, graph, trigger_config)
      values ('${version}', '${org}', '${flow}', 1, '{}'::jsonb, '{"kind":"manual"}'::jsonb)
      on conflict (id) do nothing;
    insert into public.flow_executions
      (id, organization_id, flow_id, version_id, status, current_node_id, next_eval_at)
      values ('${execution}', '${org}', '${flow}', '${version}', 'pending', 'start', now())
      on conflict (id) do nothing;
    insert into public.flow_execution_events
      (id, organization_id, execution_id, event_type)
      values ('${event}', '${org}', '${execution}', 'started')
      on conflict (id) do nothing;
  `;
}

beforeAll(() => {
  sql(
    semear(ORG_A, USER_A, FLOW_A, VERSION_A, EXECUTION_A, EVENT_A, "a") +
      semear(ORG_B, USER_B, FLOW_B, VERSION_B, EXECUTION_B, EVENT_B, "b"),
  );
});

describe("controle: o cenário existe antes de qualquer conclusão", () => {
  it("cada organização tem o próprio fluxo, versão, execução e evento", () => {
    expect(countAs(USER_A, `select count(*) from public.flows;`)).toBe(1);
    expect(countAs(USER_B, `select count(*) from public.flows;`)).toBe(1);
    expect(countAs(USER_A, `select count(*) from public.flow_versions;`)).toBe(1);
    expect(countAs(USER_A, `select count(*) from public.flow_executions;`)).toBe(1);
    expect(countAs(USER_A, `select count(*) from public.flow_execution_events;`)).toBe(1);
  });
});

describe("leitura — a org A não enxerga a org B", () => {
  it("nenhum fluxo da outra organização", () => {
    expect(
      countAs(USER_A, `select count(*) from public.flows where organization_id = '${ORG_B}';`),
    ).toBe(0);
    expect(
      countAs(USER_B, `select count(*) from public.flows where organization_id = '${ORG_A}';`),
    ).toBe(0);
  });

  it("nenhuma versão da outra organização", () => {
    expect(
      countAs(
        USER_A,
        `select count(*) from public.flow_versions where organization_id = '${ORG_B}';`,
      ),
    ).toBe(0);
  });

  /** O caminho oblíquo: filtrar por `flow_id` alheio em vez de por organização. */
  it("nem pelo id do fluxo alheio", () => {
    expect(
      countAs(USER_A, `select count(*) from public.flow_versions where flow_id = '${FLOW_B}';`),
    ).toBe(0);
  });

  it("nenhuma execução da outra organização", () => {
    expect(
      countAs(
        USER_A,
        `select count(*) from public.flow_executions where organization_id = '${ORG_B}';`,
      ),
    ).toBe(0);
  });

  it("nenhum evento de execução da outra organização", () => {
    expect(
      countAs(
        USER_A,
        `select count(*) from public.flow_execution_events where organization_id = '${ORG_B}';`,
      ),
    ).toBe(0);
    // Mesmo caminho oblíquo: filtrar por execution_id alheio.
    expect(
      countAs(
        USER_A,
        `select count(*) from public.flow_execution_events where execution_id = '${EXECUTION_B}';`,
      ),
    ).toBe(0);
  });
});

describe("escrita — a org A não toca na org B", () => {
  it("update em fluxo alheio não afeta linha nenhuma", () => {
    expect(
      writeCountAs(USER_A, `update public.flows set name = 'sequestrado' where id = '${FLOW_B}'`),
    ).toBe(0);
  });

  it("delete em fluxo alheio não afeta linha nenhuma", () => {
    expect(writeCountAs(USER_A, `delete from public.flows where id = '${FLOW_B}'`)).toBe(0);
  });

  it("update em execução alheia não afeta linha nenhuma", () => {
    expect(
      writeCountAs(
        USER_A,
        `update public.flow_executions set status = 'cancelled' where id = '${EXECUTION_B}'`,
      ),
    ).toBe(0);
  });

  /** O `with check` da policy — o anti-pattern nº 10 do CLAUDE.md. */
  it("insert com organization_id alheio é barrado", () => {
    expect(
      writeCountAs(
        USER_A,
        `insert into public.flows (organization_id, name, status)
         values ('${ORG_B}', 'invasao', 'draft')`,
      ),
    ).toBe(0);
  });

  it("a linha da org B continua intacta depois de todas as tentativas", () => {
    expect(sql(`select name from public.flows where id = '${FLOW_B}';`)).toBe("Flow Invariant b");
  });
});

describe("a função de claim não é alcançável pela chave anônima", () => {
  /**
   * `fn_claim_due_flow_executions` é `security definer` e devolve linhas de
   * TODAS as organizações por desenho (é o claim do worker) — alcançável
   * pela anon key ela seria a lista de execuções de toda a instalação.
   */
  it("nem anon nem authenticated têm EXECUTE", () => {
    const grants = sql(`
      select coalesce(string_agg(distinct grantee, ',' order by grantee), '')
        from information_schema.role_routine_grants
       where routine_schema = 'public'
         and routine_name = 'fn_claim_due_flow_executions'
         and privilege_type = 'EXECUTE';
    `);
    expect(grants).not.toMatch(/(^|,)anon(,|$)/);
    expect(grants).not.toMatch(/(^|,)authenticated(,|$)/);
    expect(grants).not.toMatch(/(^|,)PUBLIC(,|$)/i);
  });

  it("service_role tem EXECUTE — senão o worker não roda", () => {
    const grants = sql(`
      select coalesce(string_agg(distinct grantee, ',' order by grantee), '')
        from information_schema.role_routine_grants
       where routine_schema = 'public'
         and routine_name = 'fn_claim_due_flow_executions'
         and privilege_type = 'EXECUTE';
    `);
    expect(grants).toMatch(/service_role/);
  });
});
