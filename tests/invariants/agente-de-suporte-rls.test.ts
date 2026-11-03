import { describe, expect, it } from "vitest";

import { countAs, sql } from "./gov-helpers";

/**
 * O que a migration 0250 promete, cobrado no banco que o CLONE recebe
 * (`supabase/baseline.sql` num Postgres descartável).
 *
 *  1. **Cada um lê só o seu.** O histórico com a assistente de suporte é da
 *     PESSOA: nem o admin da mesma organização nem membro de outra o lê.
 *  2. **O cliente não escreve.** Se `authenticated` pudesse inserir em
 *     `agente_mensagens`, a anon key do navegador bastaria para forjar 50
 *     perguntas no nome de outra pessoa e esgotar o limite diário dela. A
 *     escrita é revogada no GRANT (não só na policy).
 */

const ORG_A = "0250aaaa-0000-4000-8000-000000000001";
const ORG_B = "0250bbbb-0000-4000-8000-000000000002";
const PESSOA_A = "0250aaaa-1111-4000-8000-000000000001";
const ADMIN_A = "0250aaaa-1111-4000-8000-000000000002";
const PESSOA_B = "0250bbbb-1111-4000-8000-000000000001";
const CONV_A = "0250aaaa-2222-4000-8000-000000000001";
const CONV_B = "0250bbbb-2222-4000-8000-000000000001";

function seed(): void {
  sql(`
    insert into auth.users (id, email) values
      ('${PESSOA_A}', 'agente-a@invariant.test'),
      ('${ADMIN_A}', 'agente-adm@invariant.test'),
      ('${PESSOA_B}', 'agente-b@invariant.test')
      on conflict do nothing;
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'agente-inv-a', 'Agente Inv A', 'Agente A'),
      ('${ORG_B}', 'agente-inv-b', 'Agente Inv B', 'Agente B')
      on conflict do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${PESSOA_A}', '${ORG_A}', 'agent', now()),
      ('${ADMIN_A}', '${ORG_A}', 'admin', now()),
      ('${PESSOA_B}', '${ORG_B}', 'admin', now())
      on conflict do nothing;
    insert into public.agente_conversas (id, organization_id, user_id) values
      ('${CONV_A}', '${ORG_A}', '${PESSOA_A}'),
      ('${CONV_B}', '${ORG_B}', '${PESSOA_B}')
      on conflict do nothing;
    insert into public.agente_mensagens (organization_id, conversa_id, user_id, role, content)
      select '${ORG_A}', '${CONV_A}', '${PESSOA_A}', 'user', 'pergunta da A'
       where not exists (select 1 from public.agente_mensagens where conversa_id = '${CONV_A}');
    insert into public.agente_mensagens (organization_id, conversa_id, user_id, role, content)
      select '${ORG_B}', '${CONV_B}', '${PESSOA_B}', 'user', 'pergunta da B'
       where not exists (select 1 from public.agente_mensagens where conversa_id = '${CONV_B}');
  `);
}

function erroComo(userId: string, dml: string): string {
  try {
    sql(`
      set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
      ${dml};
    `);
  } catch (e) {
    const err = e as { stderr?: Buffer | string; message?: string };
    return String(err.stderr ?? "") + String(err.message ?? "");
  }
  return "";
}

describe("0250 · histórico da assistente de suporte: cada um lê o seu, ninguém escreve pelo cliente", () => {
  it("as duas tabelas nascem com RLS ligada", () => {
    seed();
    expect(
      sql(`select string_agg(relname || ':' || relrowsecurity, ',' order by relname)
             from pg_class where relname in ('agente_conversas','agente_mensagens') and relkind = 'r'`),
    ).toBe("agente_conversas:true,agente_mensagens:true");
  });

  it("a pessoa lê a própria conversa e mensagens (controle positivo)", () => {
    expect(countAs(PESSOA_A, `select count(*) from public.agente_conversas;`)).toBe(1);
    expect(countAs(PESSOA_A, `select count(*) from public.agente_mensagens;`)).toBe(1);
  });

  it("membro de outra organização não lê nada da A", () => {
    expect(
      countAs(
        PESSOA_B,
        `select count(*) from public.agente_mensagens where organization_id = '${ORG_A}';`,
      ),
    ).toBe(0);
    expect(
      countAs(
        PESSOA_B,
        `select count(*) from public.agente_conversas where organization_id = '${ORG_A}';`,
      ),
    ).toBe(0);
  });

  it("nem o admin da MESMA organização lê a conversa de ajuda de outra pessoa", () => {
    expect(countAs(ADMIN_A, `select count(*) from public.agente_mensagens;`)).toBe(0);
    expect(countAs(ADMIN_A, `select count(*) from public.agente_conversas;`)).toBe(0);
  });

  it("o cliente NÃO insere pergunta (nem no próprio nome, nem no alheio) — permission denied", () => {
    expect(
      erroComo(
        PESSOA_A,
        `insert into public.agente_mensagens (organization_id, conversa_id, user_id, role, content)
         values ('${ORG_B}', '${CONV_B}', '${PESSOA_B}', 'user', 'forjada')`,
      ),
    ).toMatch(/permission denied/);
    expect(
      erroComo(
        PESSOA_A,
        `insert into public.agente_conversas (organization_id, user_id) values ('${ORG_A}', '${PESSOA_A}')`,
      ),
    ).toMatch(/permission denied/);
  });

  it("o cliente NÃO apaga nem edita o próprio histórico — permission denied", () => {
    expect(
      erroComo(PESSOA_A, `delete from public.agente_mensagens where conversa_id = '${CONV_A}'`),
    ).toMatch(/permission denied/);
    expect(
      erroComo(
        PESSOA_A,
        `update public.agente_mensagens set content = 'x' where conversa_id = '${CONV_A}'`,
      ),
    ).toMatch(/permission denied/);
    expect(
      sql(`select count(*) from public.agente_mensagens where conversa_id = '${CONV_A}'`),
    ).toBe("1");
  });

  it("0251 · quem saiu da organização não segue lendo o que perguntou lá", () => {
    sql(`update public.user_organizations set revoked_at = now()
          where user_id = '${PESSOA_A}' and organization_id = '${ORG_A}'`);
    try {
      expect(countAs(PESSOA_A, `select count(*) from public.agente_mensagens;`)).toBe(0);
      expect(countAs(PESSOA_A, `select count(*) from public.agente_conversas;`)).toBe(0);
    } finally {
      sql(`update public.user_organizations set revoked_at = null
            where user_id = '${PESSOA_A}' and organization_id = '${ORG_A}'`);
    }
    expect(countAs(PESSOA_A, `select count(*) from public.agente_mensagens;`)).toBe(1);
  });

  it("0251 · a reserva diária para no teto, e o cliente não a alcança", () => {
    sql(`delete from public.agente_uso_diario where user_id = '${PESSOA_B}'`);
    const reservar = () =>
      sql(
        `select coalesce(public.fn_agente_reservar_pergunta('${PESSOA_B}', '2026-11-03', 2)::text, 'null')`,
      );
    expect([reservar(), reservar(), reservar()]).toEqual(["1", "2", "null"]);
    expect(
      sql(
        `select perguntas from public.agente_uso_diario where user_id = '${PESSOA_B}' and dia = '2026-11-03'`,
      ),
    ).toBe("2");

    expect(
      erroComo(
        PESSOA_B,
        `select public.fn_agente_reservar_pergunta('${PESSOA_B}', '2026-11-04', 50)`,
      ),
    ).toMatch(/permission denied/);
    expect(erroComo(PESSOA_B, `select * from public.agente_uso_diario`)).toMatch(
      /permission denied/,
    );
  });

  it("0251 · contato anonimizado some também do histórico da assistente da organização (e só dela)", () => {
    const CONTATO = "0250aaaa-3333-4000-8000-000000000001";
    sql(`
      insert into public.contacts (id, organization_id, name, display_name)
        values ('${CONTATO}', '${ORG_A}', 'Joaquina Prado', 'Joaquina') on conflict do nothing;
      insert into public.agente_mensagens (organization_id, conversa_id, user_id, role, content)
        values ('${ORG_A}', '${CONV_A}', '${PESSOA_A}', 'assistant', 'A conversa com JOAQUINA PRADO está aberta.'),
               ('${ORG_B}', '${CONV_B}', '${PESSOA_B}', 'assistant', 'Joaquina Prado é de outra empresa.');
      update public.contacts set name = 'Cliente Anonimizado #1', display_name = 'Cliente Anonimizado #1',
             is_anonymized = true, anonymized_at = now() where id = '${CONTATO}';
    `);
    expect(
      sql(
        `select count(*) from public.agente_mensagens where organization_id = '${ORG_A}' and content ilike '%joaquina%'`,
      ),
    ).toBe("0");
    expect(
      sql(
        `select count(*) from public.agente_mensagens where content = 'A conversa com Cliente anonimizado está aberta.'`,
      ),
    ).toBe("1");
    // A outra organização tem outro contato com o mesmo nome — não é o anonimizado.
    expect(
      sql(
        `select count(*) from public.agente_mensagens where organization_id = '${ORG_B}' and content ilike '%joaquina%'`,
      ),
    ).toBe("1");
  });

  it("0251 · o expurgo respeita o piso de 30 dias no corpo da função", () => {
    sql(`
      insert into public.agente_mensagens (organization_id, conversa_id, user_id, role, content, created_at)
        values ('${ORG_A}', '${CONV_A}', '${PESSOA_A}', 'user', 'velha', now() - interval '200 days'),
               ('${ORG_A}', '${CONV_A}', '${PESSOA_A}', 'user', 'de vinte dias', now() - interval '20 days');
    `);
    // Pedir 1 dia vira 30: a de vinte dias fica.
    sql(`select public.fn_expurgar_historico_do_agente(1, 1000)`);
    expect(sql(`select count(*) from public.agente_mensagens where content = 'velha'`)).toBe("0");
    expect(
      sql(`select count(*) from public.agente_mensagens where content = 'de vinte dias'`),
    ).toBe("1");
  });

  it("role fora do vocabulário é recusado pelo CHECK", () => {
    expect(() =>
      sql(`insert into public.agente_mensagens (organization_id, conversa_id, user_id, role, content)
           values ('${ORG_A}', '${CONV_A}', '${PESSOA_A}', 'tool', 'x')`),
    ).toThrow(/agente_mensagens_role_check/);
  });
});
