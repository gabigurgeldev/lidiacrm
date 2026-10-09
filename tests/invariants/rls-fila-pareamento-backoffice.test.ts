/**
 * ISOLAMENTO ENTRE ORGANIZAÇÕES — fila indiana, link de pareamento e Back Office.
 *
 * Três tabelas entraram na `main` (migrations 0211, 0213 e 0216) com RLS ligada
 * e policy escrita, mas sem nenhuma prova de COMPORTAMENTO — e
 * `rls-completude-varredura.test.ts` reprova exatamente isso: policy presente
 * não é isolamento (a de `org_guardrail_layers` dizia `... or true` e passava
 * em toda checagem de catálogo). A prova só existe simulando o JWT de um
 * usuário de verdade e CONTANDO linhas da outra organização.
 *
 * O que cada tabela mede, nas duas direções e com controle positivo:
 *
 *   - `flow_routing_cursors` (0211): a policy exige `manager`. O gerente da A lê
 *     a fila da A e não a da B; o ATENDENTE da A não lê nem a da A (o gate de
 *     papel); e o gerente da A não escreve na B.
 *   - `channel_pairing_links` (0213, papel na 0235): o gerente da A lê o link da
 *     A e não o da B; o ATENDENTE da A não lê nem o da A (o token pareia um
 *     WhatsApp — a rota exige `manager`); ninguém cria link pela API direta.
 *   - `backoffice_tenants` (0216, papel na 0235): o admin da A lê a linha da A
 *     e não a da B; o gerente da A não lê; ninguém grava pela API direta.
 *
 * "Não escreve na B" conta como 0 linhas tanto um `with check` violado quanto
 * um `permission denied` — `writeCountAs` trata os dois como bloqueio.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { countAs, sql, writeCountAs } from "./gov-helpers";

// UUIDs próprios, para este arquivo não disputar linhas com os outros.
const ORG_A = "f1a0a0a0-0000-4000-8000-00000000000a";
const ORG_B = "f1a0a0a0-0000-4000-8000-00000000000b";
const GERENTE_A = "f1a0a0a0-1111-4000-8000-00000000000a";
const ATENDENTE_A = "f1a0a0a0-1111-4000-8000-00000000000c";
const GERENTE_B = "f1a0a0a0-1111-4000-8000-00000000000b";
const ADMIN_A = "f1a0a0a0-1111-4000-8000-00000000000d";
const FLUXO_A = "f1a0a0a0-2222-4000-8000-00000000000a";
const FLUXO_B = "f1a0a0a0-2222-4000-8000-00000000000b";
const CANAL_A = "f1a0a0a0-3333-4000-8000-00000000000a";
const CANAL_B = "f1a0a0a0-3333-4000-8000-00000000000b";

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${GERENTE_A}',   'fila-gerente-a@invariant.test'),
      ('${ATENDENTE_A}', 'fila-atendente-a@invariant.test'),
      ('${GERENTE_B}',   'fila-gerente-b@invariant.test'),
      ('${ADMIN_A}',     'fila-admin-a@invariant.test')
      on conflict (id) do nothing;

    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'rls-fila-a', 'RLS Fila A', 'Fila A'),
      ('${ORG_B}', 'rls-fila-b', 'RLS Fila B', 'Fila B')
      on conflict (id) do nothing;

    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${GERENTE_A}',   '${ORG_A}', 'manager', now()),
      ('${ATENDENTE_A}', '${ORG_A}', 'agent',   now()),
      ('${GERENTE_B}',   '${ORG_B}', 'manager', now()),
      ('${ADMIN_A}',     '${ORG_A}', 'admin',   now())
      on conflict do nothing;

    insert into public.flows (id, organization_id, name, status) values
      ('${FLUXO_A}', '${ORG_A}', 'Fluxo da fila A', 'draft'),
      ('${FLUXO_B}', '${ORG_B}', 'Fluxo da fila B', 'draft')
      on conflict (id) do nothing;

    insert into public.flow_routing_cursors (organization_id, flow_id, node_id, posicao) values
      ('${ORG_A}', '${FLUXO_A}', 'fila', 1),
      ('${ORG_B}', '${FLUXO_B}', 'fila', 2)
      on conflict do nothing;

    insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted) values
      ('${CANAL_A}', '${ORG_A}', 'rls-fila-a', '\\x00'::bytea),
      ('${CANAL_B}', '${ORG_B}', 'rls-fila-b', '\\x00'::bytea)
      on conflict (id) do nothing;

    insert into public.channel_pairing_links (organization_id, channel_session_id, expires_at)
    select v.org, v.canal, now() + interval '30 minutes'
      from (values ('${ORG_A}'::uuid, '${CANAL_A}'::uuid), ('${ORG_B}'::uuid, '${CANAL_B}'::uuid)) as v(org, canal)
     where not exists (select 1 from public.channel_pairing_links l where l.organization_id = v.org);

    insert into public.backoffice_tenants (organization_id, request_id, owner_email) values
      ('${ORG_A}', gen_random_uuid(), 'dono-a@invariant.test'),
      ('${ORG_B}', gen_random_uuid(), 'dono-b@invariant.test')
      on conflict (organization_id) do nothing;
  `);
});

const conta = (usuario: string, tabela: string, org: string) =>
  countAs(usuario, `select count(*) from public.${tabela} where organization_id = '${org}';`);

describe("flow_routing_cursors — fila indiana (0211, só gerente)", () => {
  it("o gerente da A lê a fila da A (controle positivo)", () => {
    expect(conta(GERENTE_A, "flow_routing_cursors", ORG_A)).toBeGreaterThanOrEqual(1);
  });
  it("o gerente da A não lê a fila da B", () => {
    expect(conta(GERENTE_A, "flow_routing_cursors", ORG_B)).toBe(0);
  });
  it("pedindo a tabela inteira, o gerente da A só recebe linhas da A", () => {
    expect(
      countAs(GERENTE_A, `select count(*) from public.flow_routing_cursors where organization_id <> '${ORG_A}';`),
    ).toBe(0);
  });
  it("o atendente da A não lê nem a fila da própria organização (gate de papel)", () => {
    expect(conta(ATENDENTE_A, "flow_routing_cursors", ORG_A)).toBe(0);
  });
  it("o gerente da A não escreve na fila da B", () => {
    expect(
      writeCountAs(
        GERENTE_A,
        `insert into public.flow_routing_cursors (organization_id, flow_id, node_id) values ('${ORG_B}', '${FLUXO_B}', 'intruso')`,
      ),
    ).toBe(0);
  });
});

describe("channel_pairing_links — link de pareamento (0213, papel na 0235)", () => {
  it("o gerente da A lê o link da A (controle positivo)", () => {
    expect(conta(GERENTE_A, "channel_pairing_links", ORG_A)).toBeGreaterThanOrEqual(1);
  });
  it("o gerente da A não lê o link da B", () => {
    expect(conta(GERENTE_A, "channel_pairing_links", ORG_B)).toBe(0);
  });
  it("o atendente da A não lê o token nem da própria organização", () => {
    expect(conta(ATENDENTE_A, "channel_pairing_links", ORG_A)).toBe(0);
  });
  it("ninguém cria link pela API direta — nem na própria organização", () => {
    expect(
      writeCountAs(
        GERENTE_A,
        `insert into public.channel_pairing_links (organization_id, channel_session_id, expires_at) values ('${ORG_A}', '${CANAL_A}', now() + interval '30 minutes')`,
      ),
    ).toBe(0);
  });
  it("o gerente da A não cria link de pareamento para o número da B", () => {
    expect(
      writeCountAs(
        GERENTE_A,
        `insert into public.channel_pairing_links (organization_id, channel_session_id, expires_at) values ('${ORG_B}', '${CANAL_B}', now() + interval '30 minutes')`,
      ),
    ).toBe(0);
  });
});

describe("backoffice_tenants — vínculo com o Back Office (0216, papel na 0235)", () => {
  it("o admin da A lê a linha da A (controle positivo)", () => {
    expect(conta(ADMIN_A, "backoffice_tenants", ORG_A)).toBe(1);
  });
  it("o admin da A não lê a linha da B", () => {
    expect(conta(ADMIN_A, "backoffice_tenants", ORG_B)).toBe(0);
  });
  it("o gerente da A não lê o vínculo do Back Office", () => {
    expect(conta(GERENTE_A, "backoffice_tenants", ORG_A)).toBe(0);
  });
  it("nem o admin da A altera a própria linha pela API direta", () => {
    expect(
      writeCountAs(ADMIN_A, `update public.backoffice_tenants set plan_name = 'mexido' where organization_id = '${ORG_A}'`),
    ).toBe(0);
  });
  it("o membro da A não altera a linha da B", () => {
    expect(
      writeCountAs(
        GERENTE_A,
        `update public.backoffice_tenants set plan_name = 'invadido' where organization_id = '${ORG_B}'`,
      ),
    ).toBe(0);
  });
});
