import { describe, expect, it } from "vitest";

import { countAs, sql, writeCountAs } from "./gov-helpers";

/**
 * O que a migration 0223 (Integrações via API) promete, cobrado no banco que o
 * CLONE recebe (`supabase/baseline.sql` num Postgres descartável).
 *
 *  1. Configuração isolada por organização: o manager da A lê as integrações e
 *     endpoints da A e NÃO os da B; o `agent` não lê nem os da própria org
 *     (a tela é de manager); só o admin escreve, e só na própria org.
 *  2. Segredo e verificação são INVISÍVEIS ao cliente, inclusive ao admin da
 *     própria organização: permission denied, não zero linhas.
 *  3. Ação pendente e log de chamadas: manager lê; ninguém escreve pela anon
 *     key — quem confirma a ação é o runtime, nunca um UPDATE do browser.
 *  4. O banco recusa ação sem texto de confirmação e duas ações esperando o SIM
 *     na mesma conversa.
 *  5. A versão publicada do agente não troca de endpoints sem virar versão nova.
 *  6. Anonimizar o contato apaga a verificação e redige a ação.
 */

const ORG_A = "0223aaaa-0000-4000-8000-000000000001";
const ORG_B = "0223bbbb-0000-4000-8000-000000000002";
const ADMIN_A = "0223aaaa-1111-4000-8000-000000000001";
const MANAGER_A = "0223aaaa-2222-4000-8000-000000000002";
const AGENT_A = "0223aaaa-3333-4000-8000-000000000003";
const SESS_A = "0223aaaa-4444-4000-8000-000000000001";
const CT_A = "0223aaaa-5555-4000-8000-000000000001";
const CONV_A = "0223aaaa-6666-4000-8000-000000000001";
const INT_A = "0223aaaa-7777-4000-8000-000000000001";
const INT_B = "0223bbbb-7777-4000-8000-000000000002";
const EP_A = "0223aaaa-8888-4000-8000-000000000001";
const EP_ACAO_A = "0223aaaa-8888-4000-8000-000000000002";
const EP_B = "0223bbbb-8888-4000-8000-000000000003";
const VER_A = "0223aaaa-9999-4000-8000-000000000001";
const ACAO_A = "0223aaaa-aaaa-4000-8000-000000000001";
const AGENTE_IA = "0223aaaa-bbbb-4000-8000-000000000001";
const VERSAO_IA = "0223aaaa-cccc-4000-8000-000000000001";

function seed(): void {
  sql(`
    insert into auth.users (id, email) values
      ('${ADMIN_A}', 'api-admin@invariant.test'),
      ('${MANAGER_A}', 'api-manager@invariant.test'),
      ('${AGENT_A}', 'api-agent@invariant.test')
      on conflict do nothing;
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'api-inv-a', 'API Inv A', 'API A'),
      ('${ORG_B}', 'api-inv-b', 'API Inv B', 'API B')
      on conflict do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${ADMIN_A}', '${ORG_A}', 'admin', now()),
      ('${MANAGER_A}', '${ORG_A}', 'manager', now()),
      ('${AGENT_A}', '${ORG_A}', 'agent', now())
      on conflict do nothing;
    insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted) values
      ('${SESS_A}', '${ORG_A}', 'api-inv-a', '\\x00'::bytea)
      on conflict (id) do nothing;
    insert into public.contacts (id, organization_id, display_name, phone_number) values
      ('${CT_A}', '${ORG_A}', 'Cliente A', '+5511900000223')
      on conflict (id) do nothing;
    insert into public.conversations (id, organization_id, contact_id, channel_session_id) values
      ('${CONV_A}', '${ORG_A}', '${CT_A}', '${SESS_A}')
      on conflict (id) do nothing;

    insert into public.ai_api_integrations (id, organization_id, nome, base_url, auth_tipo) values
      ('${INT_A}', '${ORG_A}', 'Sistema A', 'https://a.example.com', 'bearer'),
      ('${INT_B}', '${ORG_B}', 'Sistema B', 'https://b.example.com', 'bearer')
      on conflict (id) do nothing;
    insert into public.ai_api_integration_secrets (integration_id, organization_id, segredo_encrypted, segredo_iv, segredo_tag) values
      ('${INT_A}', '${ORG_A}', '\\x01'::bytea, '\\x02'::bytea, '\\x03'::bytea)
      on conflict do nothing;
    insert into public.ai_api_endpoints (id, organization_id, integration_id, slug, titulo, caminho, modo, texto_de_confirmacao) values
      ('${EP_A}', '${ORG_A}', '${INT_A}', 'pedido', 'Pedido', '/pedidos', 'leitura', null),
      ('${EP_ACAO_A}', '${ORG_A}', '${INT_A}', 'reenviar', 'Reenviar', '/reenviar', 'acao', 'Posso reenviar?'),
      ('${EP_B}', '${ORG_B}', '${INT_B}', 'pedido', 'Pedido B', '/pedidos', 'leitura', null)
      on conflict (id) do nothing;
    insert into public.ai_api_verificacoes
      (id, organization_id, conversation_id, contact_id, email_hash, email_mascarado, email_encrypted, email_iv, email_tag, codigo_expira_em)
    values
      ('${VER_A}', '${ORG_A}', '${CONV_A}', '${CT_A}', 'h', 'd***o@l***a.com', '\\x01'::bytea, '\\x02'::bytea, '\\x03'::bytea, now() + interval '10 minutes')
      on conflict (id) do nothing;
    insert into public.ai_api_acoes_pendentes
      (id, organization_id, conversation_id, contact_id, endpoint_id, params_congelados, resumo, expira_em)
    values
      ('${ACAO_A}', '${ORG_A}', '${CONV_A}', '${CT_A}', '${EP_ACAO_A}', '{"pedido":"123"}', 'Posso reenviar o pedido 123?', now() + interval '15 minutes')
      on conflict (id) do nothing;
    insert into public.ai_api_chamadas (organization_id, integration_id, endpoint_id, origem, ok) values
      ('${ORG_A}', '${INT_A}', '${EP_A}', 'agente', true);
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

const TABELAS = [
  "ai_api_acoes_pendentes",
  "ai_api_chamadas",
  "ai_api_endpoints",
  "ai_api_integration_secrets",
  "ai_api_integrations",
  "ai_api_verificacoes",
];

describe("0223 · Integrações via API chegam ao clone, isoladas por organização", () => {
  it("as seis tabelas nascem com RLS ligada", () => {
    seed();
    expect(
      sql(`select string_agg(relname || ':' || relrowsecurity, ',' order by relname)
             from pg_class where relname = any(array[${TABELAS.map((t) => `'${t}'`).join(",")}]) and relkind = 'r'`),
    ).toBe(TABELAS.map((t) => `${t}:true`).join(","));
  });

  it("manager da A lê integrações e endpoints da A, e não os da B", () => {
    const q = (tabela: string, org: string) => `select count(*) from public.${tabela} where organization_id = '${org}';`;
    expect(countAs(MANAGER_A, q("ai_api_integrations", ORG_A))).toBe(1);
    expect(countAs(MANAGER_A, q("ai_api_integrations", ORG_B))).toBe(0);
    expect(countAs(MANAGER_A, q("ai_api_endpoints", ORG_A))).toBe(2);
    expect(countAs(MANAGER_A, q("ai_api_endpoints", ORG_B))).toBe(0);
    // Pedido da tabela INTEIRA, sem filtro: a policy é quem recorta.
    expect(countAs(MANAGER_A, `select count(*) from public.ai_api_endpoints;`)).toBe(2);
  });

  it("agent da própria org não lê a configuração (a tela é de manager)", () => {
    expect(countAs(AGENT_A, `select count(*) from public.ai_api_integrations;`)).toBe(0);
    expect(countAs(AGENT_A, `select count(*) from public.ai_api_endpoints;`)).toBe(0);
  });

  it("só o admin escreve, e só na própria organização", () => {
    expect(writeCountAs(MANAGER_A, `update public.ai_api_integrations set nome = 'x' where id = '${INT_A}'`)).toBe(0);
    expect(writeCountAs(ADMIN_A, `update public.ai_api_integrations set nome = 'Sistema A2' where id = '${INT_A}'`)).toBe(1);
    expect(writeCountAs(ADMIN_A, `update public.ai_api_integrations set base_url = 'https://evil.example.com' where id = '${INT_B}'`)).toBe(0);
    expect(writeCountAs(ADMIN_A, `update public.ai_api_endpoints set caminho = '/x' where id = '${EP_B}'`)).toBe(0);
    expect(sql(`select base_url from public.ai_api_integrations where id = '${INT_B}'`)).toBe("https://b.example.com");
  });

  it("segredo e verificação: permission denied até para o admin da própria org", () => {
    expect(erroComo(ADMIN_A, `select count(*) from public.ai_api_integration_secrets`)).toMatch(/permission denied/);
    expect(erroComo(ADMIN_A, `select count(*) from public.ai_api_verificacoes`)).toMatch(/permission denied/);
    expect(
      erroComo(ADMIN_A, `update public.ai_api_verificacoes set status = 'verificado' where id = '${VER_A}'`),
    ).toMatch(/permission denied/);
  });

  it("ação pendente e chamadas: manager lê, ninguém confirma pela anon key", () => {
    expect(countAs(MANAGER_A, `select count(*) from public.ai_api_acoes_pendentes;`)).toBe(1);
    expect(countAs(MANAGER_A, `select count(*) from public.ai_api_chamadas;`)).toBe(1);
    expect(
      erroComo(ADMIN_A, `update public.ai_api_acoes_pendentes set status = 'executando' where id = '${ACAO_A}'`),
    ).toMatch(/permission denied/);
    expect(
      erroComo(ADMIN_A, `insert into public.ai_api_chamadas (organization_id, integration_id, origem, ok) values ('${ORG_A}', '${INT_A}', 'teste', true)`),
    ).toMatch(/permission denied/);
    expect(sql(`select status from public.ai_api_acoes_pendentes where id = '${ACAO_A}'`)).toBe("aguardando");
  });

  it("banco recusa ação sem texto de confirmação", () => {
    expect(() =>
      sql(`insert into public.ai_api_endpoints (organization_id, integration_id, slug, titulo, caminho, modo)
           values ('${ORG_A}', '${INT_A}', 'sem_texto', 'Sem texto', '/x', 'acao')`),
    ).toThrow(/ai_api_endpoints_confirmacao_check/);
  });

  it("banco recusa duas ações esperando o SIM na mesma conversa", () => {
    expect(() =>
      sql(`insert into public.ai_api_acoes_pendentes
             (organization_id, conversation_id, contact_id, endpoint_id, resumo, expira_em)
           values ('${ORG_A}', '${CONV_A}', '${CT_A}', '${EP_ACAO_A}', 'outra', now() + interval '15 minutes')`),
    ).toThrow(/ai_api_acoes_pendentes_uma_por_conversa/);
  });

  it("versão publicada não troca de endpoints sem virar versão nova", () => {
    sql(`
      insert into public.ai_agents (id, organization_id, name, system_prompt)
        values ('${AGENTE_IA}', '${ORG_A}', 'Agente API', 'system') on conflict (id) do nothing;
      insert into public.ai_agent_versions
        (id, organization_id, agent_id, version_number, system_prompt, provider, model, channel_session_id, status, api_endpoint_ids)
      values ('${VERSAO_IA}', '${ORG_A}', '${AGENTE_IA}', 1, 'system', 'anthropic', 'claude-sonnet-4-6', '${SESS_A}', 'published', array['${EP_A}']::uuid[])
        on conflict (id) do nothing;
    `);
    expect(() =>
      sql(`update public.ai_agent_versions set api_endpoint_ids = array['${EP_ACAO_A}']::uuid[] where id = '${VERSAO_IA}'`),
    ).toThrow(/imutável/);
  });

  it("anonimizar o contato apaga a verificação e redige a ação", () => {
    sql(`select public.fn_lgpd_cascade_redact_contact('${ORG_A}', '${CT_A}', gen_random_uuid())`);
    expect(sql(`select count(*) from public.ai_api_verificacoes where contact_id = '${CT_A}'`)).toBe("0");
    expect(
      sql(`select resumo || '|' || params_congelados::text || '|' || status from public.ai_api_acoes_pendentes where id = '${ACAO_A}'`),
    ).toBe("[anonimizado]|{}|cancelada");
  });
});
