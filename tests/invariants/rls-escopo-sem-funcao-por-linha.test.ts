import { beforeAll, describe, expect, it } from "vitest";

import {
  GOV_ADMIN,
  GOV_AGENT_A,
  GOV_AGENT_B,
  GOV_MANAGER,
  GOV_VIEWER,
  countAs,
  seedGov,
  sql,
} from "./gov-helpers";

/**
 * A RLS DE ESCOPO NÃO CHAMA FUNÇÃO POR LINHA (migration 0253).
 *
 * `conversations_select` e `crm_leads_select` eram `fn_can_view_*(org, dono)`:
 * uma definer não-embutível, que chama mais três definers, avaliada em CADA
 * linha candidata. Medido numa VPS de 2 vCPU: contar 475 conversas como admin
 * levava até 11,8 s; a regra escrita com InitPlan, 5 ms. Como cada mensagem
 * recebida faz cada aba do inbox reler lista, contagens e hilo, o banco saturava
 * e a mensagem já gravada demorava a aparecer na tela.
 *
 * Este arquivo cobra as duas metades: a FORMA (a policy não chama mais a função
 * por linha; o que depende de quem consulta vira InitPlan) e a SEMÂNTICA (para
 * cada papel das fixtures, a policy enxerga exatamente o que
 * `fn_can_view_conversation`/`fn_can_view_lead` diziam). O escopo por papel em
 * si segue cobrado pelos gov-5*.test.ts.
 */

const USUARIOS = { GOV_VIEWER, GOV_AGENT_A, GOV_AGENT_B, GOV_MANAGER, GOV_ADMIN };

function qualDe(tabela: string, policy: string): string {
  return sql(`
    select pg_get_expr(polqual, polrelid) from pg_policy
     where polrelid = 'public.${tabela}'::regclass and polname = '${policy}';
  `);
}

/** Conta como o papel `postgres` (sem RLS) aplicando a função antiga, com as claims do usuário. */
function contaPelaFuncao(userId: string, consulta: string): number {
  const out = sql(`
    select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
    ${consulta}
  `);
  const ultima = out.split("\n").map((s) => s.trim()).filter(Boolean).pop() ?? "";
  if (!/^\d+$/.test(ultima)) throw new Error(`saída inesperada do psql: ${out}`);
  return Number(ultima);
}

function planoComo(userId: string, consulta: string): string {
  return sql(`
    set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
    explain (costs off) ${consulta}
  `);
}

beforeAll(() => {
  seedGov();
});

describe("RLS de escopo sem função por linha", () => {
  it("conversations_select e crm_leads_select não chamam mais fn_can_view_*", () => {
    const conversa = qualDe("conversations", "conversations_select");
    const lead = qualDe("crm_leads", "crm_leads_select");
    // Guarda de vacuidade: policy sumida também não chamaria a função.
    expect(conversa).toContain("fn_orgs_com_visao_total");
    expect(lead).toContain("fn_orgs_com_visao_total");
    expect(conversa).not.toContain("fn_can_view_conversation");
    expect(lead).not.toContain("fn_can_view_lead");
  });

  it("fn_is_platform_admin sai da linha nas três policies (vira subconsulta)", () => {
    for (const [tabela, policy] of [
      ["conversations", "conversations_select"],
      ["crm_leads", "crm_leads_select"],
      ["messages", "messages_select"],
    ] as const) {
      const qual = qualDe(tabela, policy);
      expect(qual, `${tabela}.${policy}`).toMatch(/SELECT fn_is_platform_admin\(\)/);
    }
  });

  it("o plano como agent avalia o escopo uma vez (InitPlan), não por linha", () => {
    const plano = planoComo(GOV_AGENT_A, "select count(*) from public.conversations");
    expect(plano).toContain("InitPlan");
    expect(plano).not.toContain("fn_can_view_conversation");
    expect(plano).not.toContain("fn_user_role_in_org");
  });

  it("para cada papel, a policy de conversas enxerga o mesmo que fn_can_view_conversation", () => {
    for (const [nome, id] of Object.entries(USUARIOS)) {
      const pelaPolicy = countAs(id, "select count(*) from public.conversations;");
      const pelaFuncao = contaPelaFuncao(
        id,
        "select count(*) from public.conversations where public.fn_can_view_conversation(organization_id, assigned_to_user_id);",
      );
      expect(pelaPolicy, nome).toBe(pelaFuncao);
    }
  });

  it("para cada papel, a policy de leads enxerga o mesmo que fn_can_view_lead", () => {
    for (const [nome, id] of Object.entries(USUARIOS)) {
      const pelaPolicy = countAs(id, "select count(*) from public.crm_leads;");
      const pelaFuncao = contaPelaFuncao(
        id,
        "select count(*) from public.crm_leads where public.fn_can_view_lead(organization_id, owner_user_id);",
      );
      expect(pelaPolicy, nome).toBe(pelaFuncao);
    }
  });

  it("as funções novas não são executáveis por anon", () => {
    const anon = sql(`
      select string_agg(p.proname, ',') from pg_proc p
       where p.proname in ('fn_orgs_com_visao_total', 'fn_orgs_com_visao_sem_dono')
         and has_function_privilege('anon', p.oid, 'EXECUTE');
    `);
    expect(anon).toBe("");
  });
});
