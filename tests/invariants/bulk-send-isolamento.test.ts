import { beforeAll, describe, expect, it } from "vitest";

import { sql, countAs, writeCountAs } from "./gov-helpers";

/**
 * DISPARO EM MASSA — ISOLAMENTO ENTRE DUAS ORGANIZAÇÕES.
 *
 * ═══ Por que este invariante é o mais importante da feature ═══
 *
 * O disparo é a peça que MANDA MENSAGEM PARA CENTENAS DE PESSOAS. Um vazamento
 * aqui não é "a org A viu um dado da org B": é a lista de clientes de um
 * inquilino ficando alcançável para outro, e — se o vazamento chegasse à
 * escrita — a campanha de um saindo pelo número do outro.
 *
 * As duas tabelas são novas, e tabela nova é exatamente onde a RLS costuma
 * faltar: `enable row level security` sem policy fecha tudo, e policy sem
 * `enable` não fecha nada. Os dois erros passam no `install` do baseline.
 *
 * ═══ O que se mede ═══
 *
 *   1. LEITURA: usuário da org A conta ZERO linhas de disparo e de destinatário
 *      da org B.
 *   2. ESCRITA: `update` e `delete` da org A sobre linha da org B afetam ZERO
 *      linhas (`writeCountAs` trata a recusa da RLS como zero, que é o que a
 *      medição quer).
 *   3. INSERT com `organization_id` alheio é barrado pelo `with check` — é o
 *      caminho por onde um id no corpo da requisição tentaria entrar.
 *   4. A função de claim NÃO é executável por `authenticated` nem por `anon`.
 *      Ela devolve linhas de TODAS as organizações por desenho; alcançável pela
 *      chave anônima (que vai para o browser) ela seria a lista de campanhas de
 *      toda a instalação.
 *
 * Sem PII: nomes sintéticos, telefone de faixa reservada.
 */

const ORG_A = "dddddddd-0000-4000-8000-00000000000a";
const ORG_B = "dddddddd-0000-4000-8000-00000000000b";
const USER_A = "dddddddd-1111-4000-8000-00000000000a";
const USER_B = "dddddddd-1111-4000-8000-00000000000b";
const SESS_A = "dddddddd-2222-4000-8000-00000000000a";
const SESS_B = "dddddddd-2222-4000-8000-00000000000b";
const CONTATO_A = "dddddddd-3333-4000-8000-00000000000a";
const CONTATO_B = "dddddddd-3333-4000-8000-00000000000b";
const DISPARO_A = "dddddddd-4444-4000-8000-00000000000a";
const DISPARO_B = "dddddddd-4444-4000-8000-00000000000b";

function semear(org: string, user: string, sess: string, contato: string, disparo: string, tag: string): string {
  return `
    insert into auth.users (id, email) values ('${user}', 'disparo-${tag}@invariant.test')
      on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${org}', 'disparo-inv-${tag}', 'Disparo Invariant ${tag}', 'Disparo ${tag}')
      on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${user}', '${org}', 'manager', now())
      on conflict do nothing;
    insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
      values ('${sess}', '${org}', 'disparo-inv-${tag}', '\\x00'::bytea)
      on conflict (id) do nothing;
    insert into public.contacts (id, organization_id, display_name, phone_number)
      values ('${contato}', '${org}', 'Disparo Invariant Contact', '+5500900000${tag === "a" ? "01" : "02"}')
      on conflict (id) do nothing;
    insert into public.bulk_sends
      (id, organization_id, name, status, channel_session_id, provider, mode, body, interval_ms)
      values ('${disparo}', '${org}', 'Disparo ${tag}', 'draft', '${sess}', 'waha', 'freeform', 'ola', 5000)
      on conflict (id) do nothing;
    insert into public.bulk_send_recipients
      (organization_id, bulk_send_id, contact_id, status)
      values ('${org}', '${disparo}', '${contato}', 'pending')
      on conflict do nothing;
  `;
}

beforeAll(() => {
  sql(
    semear(ORG_A, USER_A, SESS_A, CONTATO_A, DISPARO_A, "a") +
      semear(ORG_B, USER_B, SESS_B, CONTATO_B, DISPARO_B, "b"),
  );
});

describe("controle: o cenário existe antes de qualquer conclusão", () => {
  it("cada organização tem o próprio disparo e o próprio destinatário", () => {
    // Sem isto, um seed que falhou renderia zero em TODA consulta — e o teste
    // de vazamento ficaria verde por não haver dado nenhum para vazar.
    expect(countAs(USER_A, `select count(*) from public.bulk_sends;`)).toBe(1);
    expect(countAs(USER_B, `select count(*) from public.bulk_sends;`)).toBe(1);
    expect(countAs(USER_A, `select count(*) from public.bulk_send_recipients;`)).toBe(1);
    expect(countAs(USER_B, `select count(*) from public.bulk_send_recipients;`)).toBe(1);
  });
});

describe("leitura — a org A não enxerga a org B", () => {
  it("nenhum disparo da outra organização", () => {
    expect(
      countAs(USER_A, `select count(*) from public.bulk_sends where organization_id = '${ORG_B}';`),
    ).toBe(0);
    expect(
      countAs(USER_B, `select count(*) from public.bulk_sends where organization_id = '${ORG_A}';`),
    ).toBe(0);
  });

  it("nenhum destinatário da outra organização", () => {
    expect(
      countAs(
        USER_A,
        `select count(*) from public.bulk_send_recipients where organization_id = '${ORG_B}';`,
      ),
    ).toBe(0);
  });

  /**
   * O caminho oblíquo: filtrar por `bulk_send_id` em vez de por organização. É
   * como uma rota mal escrita consultaria — e é por onde o vazamento entraria se
   * a policy estivesse só na tabela-pai.
   */
  it("nem pelo id do disparo alheio", () => {
    expect(
      countAs(
        USER_A,
        `select count(*) from public.bulk_send_recipients where bulk_send_id = '${DISPARO_B}';`,
      ),
    ).toBe(0);
  });
});

describe("escrita — a org A não toca na org B", () => {
  it("update em disparo alheio não afeta linha nenhuma", () => {
    expect(
      writeCountAs(
        USER_A,
        `update public.bulk_sends set name = 'sequestrado' where id = '${DISPARO_B}'`,
      ),
    ).toBe(0);
  });

  it("delete em disparo alheio não afeta linha nenhuma", () => {
    expect(writeCountAs(USER_A, `delete from public.bulk_sends where id = '${DISPARO_B}'`)).toBe(0);
  });

  it("update em destinatário alheio não afeta linha nenhuma", () => {
    expect(
      writeCountAs(
        USER_A,
        `update public.bulk_send_recipients set status = 'sent' where bulk_send_id = '${DISPARO_B}'`,
      ),
    ).toBe(0);
  });

  /**
   * O `with check` da policy. É o gate contra `organization_id` vindo do corpo
   * da requisição — o anti-pattern nº 10 do CLAUDE.md, e o modo de falha que um
   * teste só de leitura não alcança.
   */
  it("insert com organization_id alheio é barrado", () => {
    expect(
      writeCountAs(
        USER_A,
        `insert into public.bulk_sends
           (organization_id, name, status, channel_session_id, provider, mode, body, interval_ms)
         values ('${ORG_B}', 'invasao', 'draft', '${SESS_B}', 'waha', 'freeform', 'oi', 5000)`,
      ),
    ).toBe(0);
  });

  it("a linha da org B continua intacta depois de todas as tentativas", () => {
    expect(
      sql(`select name from public.bulk_sends where id = '${DISPARO_B}';`),
    ).toBe("Disparo b");
  });
});

describe("a função de claim não é alcançável pela chave anônima", () => {
  /**
   * `fn_claim_due_bulk_sends` é `security definer` e devolve linhas de TODAS as
   * organizações — é o desenho, e é por isso que o grant tem de ser só
   * `service_role`. Função em `public` nasce exposta por DUAS origens (o
   * `alter default privileges ... to anon` do baseline e o grant a PUBLIC que o
   * Postgres dá a toda função), e tratar só uma deixa a RPC alcançável pela
   * anon key — que vai para o browser.
   */
  it("nem anon nem authenticated têm EXECUTE", () => {
    const grants = sql(`
      select coalesce(string_agg(distinct grantee, ',' order by grantee), '')
        from information_schema.role_routine_grants
       where routine_schema = 'public'
         and routine_name = 'fn_claim_due_bulk_sends'
         and privilege_type = 'EXECUTE';
    `);
    expect(grants).not.toMatch(/(^|,)anon(,|$)/);
    expect(grants).not.toMatch(/(^|,)authenticated(,|$)/);
    expect(grants).not.toMatch(/(^|,)PUBLIC(,|$)/i);
  });

  it("service_role tem EXECUTE — senão o worker não roda", () => {
    // O outro lado da mesma moeda: revogar de todo mundo e esquecer de conceder
    // a quem precisa deixaria o disparo mudo, e o sintoma seria "nada sai" sem
    // erro nenhum na tela.
    const grants = sql(`
      select coalesce(string_agg(distinct grantee, ',' order by grantee), '')
        from information_schema.role_routine_grants
       where routine_schema = 'public'
         and routine_name = 'fn_claim_due_bulk_sends'
         and privilege_type = 'EXECUTE';
    `);
    expect(grants).toMatch(/service_role/);
  });
});
