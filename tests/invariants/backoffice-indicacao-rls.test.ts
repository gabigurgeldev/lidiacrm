import { describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

/**
 * O que a migration 0221 promete, cobrado no banco que o CLONE recebe
 * (`supabase/baseline.sql` num Postgres descartável).
 *
 *  1. **O cliente não lê.** A fila carrega o e-mail do dono e o código do
 *     afiliado; a indicação carrega o desconto. Nenhum membro enxerga nem a da
 *     própria organização — nem a de outra.
 *  2. **O cliente não escreve.** Um membro que gravasse a própria indicação
 *     escolheria o desconto da mensalidade. Permission denied, não 0 linhas.
 *  3. **`event_id` é único.** O webhook e a conciliação passam pela mesma
 *     cobrança muitas vezes; a segunda inserção não pode virar outro evento.
 */

const ORG_A = "0221aaaa-0000-4000-8000-000000000001";
const ORG_B = "0221bbbb-0000-4000-8000-000000000002";
const MEMBRO_A = "0221aaaa-1111-4000-8000-000000000001";

function seed(): void {
  sql(`
    insert into auth.users (id, email) values ('${MEMBRO_A}', 'bo-a@invariant.test') on conflict do nothing;
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'bo-inv-a', 'BO Inv A', 'BO A'),
      ('${ORG_B}', 'bo-inv-b', 'BO Inv B', 'BO B')
      on conflict do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${MEMBRO_A}', '${ORG_A}', 'admin', now()) on conflict do nothing;
    insert into public.backoffice_indicacoes (organization_id, affiliate_code, desconto_bps)
      values ('${ORG_A}', 'JOAO10', 1000), ('${ORG_B}', 'MARIA20', 2000)
      on conflict do nothing;
    insert into public.backoffice_saida (event_id, organization_id, tipo, payload)
      values ('crm_inv_0221_a', '${ORG_A}', 'customer.created', '{}'),
             ('crm_inv_0221_b', '${ORG_B}', 'customer.created', '{}')
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

describe("0221 · indicação e fila do Back Office chegam ao clone, invisíveis ao cliente", () => {
  it("as duas tabelas nascem com RLS ligada", () => {
    seed();
    expect(
      sql(`select string_agg(relname || ':' || relrowsecurity, ',' order by relname)
             from pg_class where relname in ('backoffice_indicacoes','backoffice_saida') and relkind = 'r'`),
    ).toBe("backoffice_indicacoes:true,backoffice_saida:true");
  });

  it("membro não lê a indicação nem a fila — nem da própria organização", () => {
    expect(erroComoMembro(`select count(*) from public.backoffice_indicacoes`)).toMatch(/permission denied/);
    expect(erroComoMembro(`select count(*) from public.backoffice_saida`)).toMatch(/permission denied/);
  });

  it("membro não escolhe o próprio desconto", () => {
    expect(
      erroComoMembro(`update public.backoffice_indicacoes set desconto_bps = 10000 where organization_id = '${ORG_A}'`),
    ).toMatch(/permission denied/);
    expect(sql(`select desconto_bps from public.backoffice_indicacoes where organization_id = '${ORG_A}'`)).toBe("1000");
  });

  it("o mesmo event_id não entra duas vezes", () => {
    sql(`insert into public.backoffice_saida (event_id, organization_id, tipo, payload)
           values ('crm_inv_0221_a', '${ORG_A}', 'customer.created', '{}') on conflict (event_id) do nothing;`);
    expect(sql(`select count(*) from public.backoffice_saida where event_id = 'crm_inv_0221_a'`)).toBe("1");
  });

  it("código fora do formato é recusado pelo banco", () => {
    let erro = "";
    try {
      sql(`insert into public.backoffice_indicacoes (organization_id, affiliate_code) values ('${ORG_B}', 'x y') on conflict (organization_id) do update set affiliate_code = excluded.affiliate_code`);
    } catch (e) {
      erro = String((e as { stderr?: unknown }).stderr ?? e);
    }
    expect(erro).toMatch(/backoffice_indicacoes_codigo_valido/);
  });
});
