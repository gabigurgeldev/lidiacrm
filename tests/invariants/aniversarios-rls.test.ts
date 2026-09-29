import { describe, expect, it } from "vitest";

import { countAs, sql } from "./gov-helpers";

/**
 * O que a migration 0218 promete, cobrado no banco que o CLONE recebe
 * (`supabase/baseline.sql` num Postgres descartável).
 *
 *  1. Membro da org A lê os envios de aniversário da A, e NÃO os da B.
 *  2. O cliente não escreve em `aniversario_envios`: é a trava de "uma vez por
 *     dia" do cron — se um membro pudesse apagar a linha do dia, a base inteira
 *     receberia os parabéns de novo na hora seguinte.
 *  3. `fn_aniversariantes_do_dia` não é RPC do navegador (só service_role), e
 *     acha 29/02 quando pedido junto com 28/02.
 */

const ORG_A = "0218aaaa-0000-4000-8000-000000000001";
const ORG_B = "0218bbbb-0000-4000-8000-000000000002";
const MEMBRO_A = "0218aaaa-1111-4000-8000-000000000001";

function seed(): void {
  sql(`
    insert into auth.users (id, email) values ('${MEMBRO_A}', 'aniv-a@invariant.test') on conflict do nothing;
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'aniv-inv-a', 'Aniv Inv A', 'Aniv A'),
      ('${ORG_B}', 'aniv-inv-b', 'Aniv Inv B', 'Aniv B')
      on conflict do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${MEMBRO_A}', '${ORG_A}', 'admin', now()) on conflict do nothing;
    insert into public.aniversario_envios (organization_id, data_local, total)
      values ('${ORG_A}', '2026-09-29', 2), ('${ORG_B}', '2026-09-29', 5)
      on conflict do nothing;
    insert into public.contacts (organization_id, name, phone_number, birthdate) values
      ('${ORG_A}', 'Leap Um', '+5511900000218', '2000-02-29'),
      ('${ORG_A}', 'Setembro', '+5511900000219', '1990-09-29'),
      ('${ORG_A}', 'Sem Telefone', null, '1990-09-29'),
      ('${ORG_B}', 'Outra Org', '+5511900000220', '1990-09-29');
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

describe("0218 · mensagem de aniversário chega ao clone, isolada e sem escrita do cliente", () => {
  it("RLS ligada", () => {
    seed();
    expect(sql(`select relrowsecurity from pg_class where relname = 'aniversario_envios' and relkind = 'r'`)).toBe("t");
  });

  it("membro da A lê os envios da A, e não os da B", () => {
    expect(countAs(MEMBRO_A, `select count(*) from public.aniversario_envios where organization_id = '${ORG_A}';`)).toBe(1);
    expect(countAs(MEMBRO_A, `select count(*) from public.aniversario_envios where organization_id = '${ORG_B}';`)).toBe(0);
  });

  it("membro NÃO apaga a trava do dia (permission denied)", () => {
    expect(
      erroComoMembro(`delete from public.aniversario_envios where organization_id = '${ORG_A}'`),
    ).toMatch(/permission denied/);
    expect(sql(`select count(*) from public.aniversario_envios where organization_id = '${ORG_A}'`)).toBe("1");
  });

  it("a trava é UMA por organização por dia", () => {
    expect(() =>
      sql(`insert into public.aniversario_envios (organization_id, data_local) values ('${ORG_A}', '2026-09-29')`),
    ).toThrow(/duplicate key|unique/i);
  });

  it("a função de aniversariantes não é chamável pelo navegador", () => {
    expect(
      erroComoMembro(`select * from public.fn_aniversariantes_do_dia('${ORG_A}', array['09-29'])`),
    ).toMatch(/permission denied/);
  });

  it("acha o dia certo, na org certa, com telefone — e o 29/02 quando pedido junto", () => {
    expect(sql(`select string_agg(nome, ',' order by nome) from public.fn_aniversariantes_do_dia('${ORG_A}', array['09-29'])`)).toBe(
      "Setembro",
    );
    expect(
      sql(`select string_agg(nome, ',' order by nome) from public.fn_aniversariantes_do_dia('${ORG_A}', array['02-28','02-29'])`),
    ).toBe("Leap Um");
  });
});
