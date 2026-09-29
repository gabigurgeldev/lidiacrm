import { describe, expect, it } from "vitest";

import { countAs, sql } from "./gov-helpers";

/**
 * O que a migration 0217 promete, cobrado no banco que o CLONE recebe
 * (`supabase/baseline.sql` num Postgres descartável).
 *
 *  1. **Isolamento de leitura.** Membro da org A lê a assinatura e as cobranças
 *     da A, e NÃO as da B.
 *  2. **O cliente não escreve.** É a propriedade que protege a receita: se
 *     `authenticated` pudesse fazer `update assinaturas set pago_ate = '2099-…'`
 *     com a anon key que vai para o navegador, qualquer membro usaria o sistema
 *     de graça para sempre. A escrita é revogada no GRANT (não só na policy).
 *  3. **`eventos_asaas` é invisível** ao cliente — payload do gateway.
 *  4. **Backfill só na primeira aplicação.** Org criada depois de a tabela ter
 *     linhas NÃO vira isenta quando o baseline é re-aplicado (`update.sh`).
 */

const ORG_A = "0217aaaa-0000-4000-8000-000000000001";
const ORG_B = "0217bbbb-0000-4000-8000-000000000002";
const ORG_NOVA = "0217cccc-0000-4000-8000-000000000003";
const MEMBRO_A = "0217aaaa-1111-4000-8000-000000000001";

function seed(): void {
  sql(`
    insert into auth.users (id, email) values ('${MEMBRO_A}', 'assin-a@invariant.test') on conflict do nothing;
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'assin-inv-a', 'Assin Inv A', 'Assin A'),
      ('${ORG_B}', 'assin-inv-b', 'Assin Inv B', 'Assin B')
      on conflict do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${MEMBRO_A}', '${ORG_A}', 'admin', now()) on conflict do nothing;
    insert into public.assinaturas (organization_id, status, trial_termina_em)
      values ('${ORG_A}', 'trial', now() + interval '7 days'),
             ('${ORG_B}', 'trial', now() + interval '7 days')
      on conflict do nothing;
    insert into public.cobrancas (organization_id, asaas_payment_id, valor_centavos, status)
      values ('${ORG_A}', 'pay_inv_0217_a', 120000, 'PENDING'),
             ('${ORG_B}', 'pay_inv_0217_b', 120000, 'PENDING')
      on conflict do nothing;
  `);
}

function erroComoMembro(dml: string): string {
  try {
    sql(`
      set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${MEMBRO_A}"}', false);
      ${dml};
    `);
  } catch (e) {
    const err = e as { stderr?: Buffer | string; message?: string };
    return String(err.stderr ?? "") + String(err.message ?? "");
  }
  return "";
}

describe("0217 · assinatura paga chega ao clone, e o cliente não a edita", () => {
  it("as três tabelas nascem com RLS ligada", () => {
    seed();
    expect(
      sql(`select string_agg(relname || ':' || relrowsecurity, ',' order by relname)
             from pg_class where relname in ('assinaturas','cobrancas','eventos_asaas') and relkind = 'r'`),
    ).toBe("assinaturas:true,cobrancas:true,eventos_asaas:true");
  });

  it("membro da A lê a própria assinatura e cobranças, e não as da B", () => {
    expect(countAs(MEMBRO_A, `select count(*) from public.assinaturas where organization_id = '${ORG_A}';`)).toBe(1);
    expect(countAs(MEMBRO_A, `select count(*) from public.assinaturas where organization_id = '${ORG_B}';`)).toBe(0);
    expect(countAs(MEMBRO_A, `select count(*) from public.cobrancas where organization_id = '${ORG_A}';`)).toBe(1);
    expect(countAs(MEMBRO_A, `select count(*) from public.cobrancas where organization_id = '${ORG_B}';`)).toBe(0);
  });

  it("membro NÃO estica o próprio pago_ate (permission denied, não 0 linhas silenciosas)", () => {
    const erro = erroComoMembro(
      `update public.assinaturas set pago_ate = '2099-01-01' where organization_id = '${ORG_A}'`,
    );
    expect(erro).toMatch(/permission denied/);
    expect(sql(`select coalesce(pago_ate::text, 'null') from public.assinaturas where organization_id = '${ORG_A}'`)).toBe("null");
  });

  it("membro NÃO se isenta nem insere cobrança paga", () => {
    expect(
      erroComoMembro(`update public.assinaturas set isenta = true where organization_id = '${ORG_A}'`),
    ).toMatch(/permission denied/);
    expect(
      erroComoMembro(
        `insert into public.cobrancas (organization_id, asaas_payment_id, valor_centavos, status, vencimento)
         values ('${ORG_A}', 'pay_forjado', 120000, 'RECEIVED', '2099-01-01')`,
      ),
    ).toMatch(/permission denied/);
  });

  it("eventos_asaas é invisível ao cliente", () => {
    expect(erroComoMembro(`select count(*) from public.eventos_asaas`)).toMatch(/permission denied/);
  });

  it("re-aplicar o backfill NÃO isenta organização nova", () => {
    sql(`insert into public.organizations (id, slug, legal_name, display_name)
           values ('${ORG_NOVA}', 'assin-inv-nova', 'Assin Nova', 'Assin Nova') on conflict do nothing;`);
    // O mesmo bloco do apêndice do baseline, re-executado como o update.sh faz.
    sql(`do $$ begin
           if not exists (select 1 from public.assinaturas) then
             insert into public.assinaturas (organization_id, status, isenta)
             select o.id, 'ativa', true from public.organizations o on conflict (organization_id) do nothing;
           end if;
         end $$;`);
    expect(sql(`select count(*) from public.assinaturas where organization_id = '${ORG_NOVA}'`)).toBe("0");
  });
});
