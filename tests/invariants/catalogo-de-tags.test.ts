import { execFileSync } from "node:child_process";

import { beforeAll, describe, expect, it } from "vitest";

/**
 * O CATÁLOGO DE TAGS (migration 0248) NO BANCO DE VERDADE.
 *
 * Arquivo próprio pelo mesmo motivo de `agenda-rls.test.ts`: o molde de
 * `rls-isolation.test.ts` prova "agent lê o seu e não o do vizinho", e aqui a
 * escrita é manager+ — o controle positivo do agent reprovaria por acerto.
 *
 * O que só o banco prova (os unitários usam dublê):
 *  1. o trigger põe no catálogo todo nome novo gravado num contato — inclusive
 *     quando quem grava é um `agent`, que a RLS não deixa escrever no catálogo;
 *  2. RLS: lê quem é da organização, escreve manager+, zero linhas do vizinho;
 *  3. uma tag em no máximo uma coluna por Kanban, e nunca coluna de outro Kanban;
 *  4. `fn_renomear_tag` propaga para os arrays, funde sem duplicar, não toca a
 *     outra organização — e não é alcançável por anon nem authenticated.
 *
 * Conectar como `postgres` mediria nada (`rolbypassrls`): as leituras e
 * escritas "como usuário" usam `set role authenticated` + `request.jwt.claims`.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error(
    "TEST_DB_CONTAINER not set — rode esta suíte via `pnpm test:db` (scripts/test-db.sh)",
  );
}
const containerName: string = container;

function psql(script: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", containerName, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tA", "-f", "-"],
    { input: script, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
}

function ultimaLinha(out: string): string {
  const linhas = out.split("\n");
  return linhas[linhas.length - 1] ?? "";
}

function comoUsuario(userId: string, script: string): string {
  return psql(`
    set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
    ${script}
  `);
}

/** Roda e devolve a mensagem de erro do Postgres, ou `null` se passou. */
function falha(script: string): string | null {
  try {
    psql(script);
    return null;
  } catch (e) {
    return String((e as { stderr?: string }).stderr ?? e);
  }
}

const ORG_A = "7a90000a-0000-4000-8000-00000000000a";
const ORG_B = "7a90000a-0000-4000-8000-00000000000b";
const AGENT_A = "7a90000a-1111-4000-8000-00000000000a";
const MANAGER_A = "7a90000a-1111-4000-8000-00000000000d";
const AGENT_B = "7a90000a-1111-4000-8000-00000000000b";
const C_A1 = "7a90000a-2222-4000-8000-0000000000a1";
const C_A2 = "7a90000a-2222-4000-8000-0000000000a2";
const C_B1 = "7a90000a-2222-4000-8000-0000000000b1";

let pipeA = "";
let pipeA2 = "";
let stageA1 = "";
let stageA2 = "";
let stageOutroKanban = "";

beforeAll(() => {
  psql(`
    insert into auth.users (id, email) values
      ('${AGENT_A}',   'tags-agent-a@invariant.test'),
      ('${MANAGER_A}', 'tags-mgr-a@invariant.test'),
      ('${AGENT_B}',   'tags-agent-b@invariant.test')
      on conflict (id) do nothing;

    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'tags-inv-a', 'Tags Invariant A', 'Tags A'),
      ('${ORG_B}', 'tags-inv-b', 'Tags Invariant B', 'Tags B')
      on conflict (id) do nothing;

    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${AGENT_A}',   '${ORG_A}', 'agent',   now()),
      ('${MANAGER_A}', '${ORG_A}', 'manager', now()),
      ('${AGENT_B}',   '${ORG_B}', 'agent',   now())
      on conflict do nothing;

    insert into public.contacts (id, organization_id, display_name, tags) values
      ('${C_A1}', '${ORG_A}', 'Contato A1', array['VIP']),
      ('${C_A2}', '${ORG_A}', 'Contato A2', array['VIP', 'Cliente VIP']),
      ('${C_B1}', '${ORG_B}', 'Contato B1', array['VIP'])
      on conflict (id) do nothing;

    insert into public.crm_pipelines (id, organization_id, name, slug, position)
    values ('7a90000a-3333-4000-8000-0000000000a1', '${ORG_A}', 'Kanban de tags A', 'kanban-tags-a', 9000),
           ('7a90000a-3333-4000-8000-0000000000a2', '${ORG_A}', 'Kanban de tags A2', 'kanban-tags-a2', 9100)
    on conflict (id) do nothing;

    insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position) values
      ('7a90000a-4444-4000-8000-0000000000a1', '${ORG_A}', '7a90000a-3333-4000-8000-0000000000a1', 'Novo', 'novo-t', 1000),
      ('7a90000a-4444-4000-8000-0000000000a2', '${ORG_A}', '7a90000a-3333-4000-8000-0000000000a1', 'Proposta', 'proposta-t', 2000),
      ('7a90000a-4444-4000-8000-0000000000a3', '${ORG_A}', '7a90000a-3333-4000-8000-0000000000a2', 'Outro', 'outro-t', 1000)
    on conflict (id) do nothing;
  `);
  pipeA = "7a90000a-3333-4000-8000-0000000000a1";
  pipeA2 = "7a90000a-3333-4000-8000-0000000000a2";
  stageA1 = "7a90000a-4444-4000-8000-0000000000a1";
  stageA2 = "7a90000a-4444-4000-8000-0000000000a2";
  stageOutroKanban = "7a90000a-4444-4000-8000-0000000000a3";
});

function tagId(org: string, nome: string): string {
  return ultimaLinha(psql(`select id from public.crm_tags where organization_id = '${org}' and name = '${nome}';`));
}

describe("trigger: nome gravado num contato nasce no catálogo", () => {
  it("cada organização ganha a SUA linha, com cor válida", () => {
    const linhas = psql(`
      select organization_id || '|' || name || '|' || (color ~ '^#[0-9a-f]{6}$')
        from public.crm_tags
       where organization_id in ('${ORG_A}', '${ORG_B}') and name = 'VIP'
       order by organization_id;`);
    expect(linhas.split("\n")).toEqual([`${ORG_A}|VIP|true`, `${ORG_B}|VIP|true`]);
  });

  it("um AGENT gravando tag nova num contato não é barrado pela RLS do catálogo", () => {
    comoUsuario(AGENT_A, `update public.contacts set tags = tags || array['Do atendente'] where id = '${C_A1}';`);
    expect(tagId(ORG_A, "Do atendente")).not.toBe("");
    expect(tagId(ORG_B, "Do atendente")).toBe("");
  });
});

describe("RLS do catálogo", () => {
  it("agent lê as tags da própria organização e zero do vizinho", () => {
    const proprias = Number(ultimaLinha(comoUsuario(AGENT_A, `select count(*) from public.crm_tags where organization_id = '${ORG_A}';`)));
    const alheias = Number(ultimaLinha(comoUsuario(AGENT_A, `select count(*) from public.crm_tags where organization_id = '${ORG_B}';`)));
    expect(proprias).toBeGreaterThan(0);
    expect(alheias).toBe(0);
  });

  it("agent NÃO cria tag no catálogo; manager cria", () => {
    const doAgente = falha(`
      set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${AGENT_A}"}', false);
      insert into public.crm_tags (organization_id, name) values ('${ORG_A}', 'Tentativa do agent');`);
    expect(doAgente).toMatch(/row-level security/);

    comoUsuario(MANAGER_A, `insert into public.crm_tags (organization_id, name, color) values ('${ORG_A}', 'Do gerente', '#16a34a');`);
    expect(tagId(ORG_A, "Do gerente")).not.toBe("");
  });

  it("manager de A não cria tag na organização B", () => {
    const erro = falha(`
      set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${MANAGER_A}"}', false);
      insert into public.crm_tags (organization_id, name) values ('${ORG_B}', 'Invasora');`);
    expect(erro).toMatch(/row-level security/);
  });

  it("vínculo tag ↔ coluna: agent não grava, vizinho não lê", () => {
    const vip = tagId(ORG_A, "VIP");
    const doAgente = falha(`
      set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${AGENT_A}"}', false);
      insert into public.crm_stage_tags (organization_id, pipeline_id, stage_id, tag_id)
      values ('${ORG_A}', '${pipeA}', '${stageA2}', '${vip}');`);
    expect(doAgente).toMatch(/row-level security/);

    comoUsuario(MANAGER_A, `
      insert into public.crm_stage_tags (organization_id, pipeline_id, stage_id, tag_id)
      values ('${ORG_A}', '${pipeA}', '${stageA2}', '${vip}');`);
    const doVizinho = Number(ultimaLinha(comoUsuario(AGENT_B, `select count(*) from public.crm_stage_tags where organization_id = '${ORG_A}';`)));
    expect(doVizinho).toBe(0);
  });
});

describe("forma do vínculo", () => {
  it("a mesma tag em DUAS colunas do mesmo Kanban é recusada", () => {
    const vip = tagId(ORG_A, "VIP");
    const erro = falha(`
      insert into public.crm_stage_tags (organization_id, pipeline_id, stage_id, tag_id)
      values ('${ORG_A}', '${pipeA}', '${stageA1}', '${vip}');`);
    expect(erro).toMatch(/crm_stage_tags_uma_coluna_por_kanban_key/);
  });

  it("coluna de OUTRO Kanban não entra com o pipeline_id deste (FK composta)", () => {
    const novo = tagId(ORG_A, "Do gerente");
    const erro = falha(`
      insert into public.crm_stage_tags (organization_id, pipeline_id, stage_id, tag_id)
      values ('${ORG_A}', '${pipeA}', '${stageOutroKanban}', '${novo}');`);
    expect(erro).toMatch(/crm_stage_tags_coluna_do_kanban_fk/);
  });

  it("a mesma tag em Kanbans DIFERENTES é permitida", () => {
    const vip = tagId(ORG_A, "VIP");
    expect(
      falha(`
        insert into public.crm_stage_tags (organization_id, pipeline_id, stage_id, tag_id)
        values ('${ORG_A}', '${pipeA2}', '${stageOutroKanban}', '${vip}');`),
    ).toBeNull();
  });
});

describe("fn_renomear_tag", () => {
  it("não é alcançável por anon nem por authenticated", () => {
    const r = psql(`
      select has_function_privilege('anon', 'public.fn_renomear_tag(uuid, uuid, text)', 'EXECUTE')
          || '|' || has_function_privilege('authenticated', 'public.fn_renomear_tag(uuid, uuid, text)', 'EXECUTE')
          || '|' || has_function_privilege('service_role', 'public.fn_renomear_tag(uuid, uuid, text)', 'EXECUTE');`);
    expect(ultimaLinha(r)).toBe("false|false|true");
  });

  it("FUNDIR 'Cliente VIP' em 'VIP': o contato fica com UMA 'VIP', a linha antiga sai, e B não muda", () => {
    const origem = tagId(ORG_A, "Cliente VIP");
    const destino = tagId(ORG_A, "VIP");
    const devolvido = ultimaLinha(psql(`select public.fn_renomear_tag('${ORG_A}', '${origem}', 'VIP');`));
    expect(devolvido).toBe(destino);
    expect(ultimaLinha(psql(`select array_to_string(tags, ',') from public.contacts where id = '${C_A2}';`))).toBe("VIP");
    expect(tagId(ORG_A, "Cliente VIP")).toBe("");
    expect(ultimaLinha(psql(`select array_to_string(tags, ',') from public.contacts where id = '${C_B1}';`))).toBe("VIP");
  });

  it("renomear propaga para os contatos e preserva o vínculo de coluna", () => {
    const vip = tagId(ORG_A, "VIP");
    psql(`select public.fn_renomear_tag('${ORG_A}', '${vip}', 'Cliente Ouro');`);
    expect(ultimaLinha(psql(`select array_to_string(tags, ',') from public.contacts where id = '${C_A2}';`))).toBe("Cliente Ouro");
    expect(Number(ultimaLinha(psql(`select count(*) from public.crm_stage_tags where tag_id = '${vip}';`)))).toBe(2);
    expect(ultimaLinha(psql(`select array_to_string(tags, ',') from public.contacts where id = '${C_B1}';`))).toBe("VIP");
  });

  it("tag de outra organização: recusa sem tocar em nada", () => {
    const deB = tagId(ORG_B, "VIP");
    const erro = falha(`select public.fn_renomear_tag('${ORG_A}', '${deB}', 'Roubada');`);
    expect(erro).toMatch(/tag não encontrada/);
    expect(tagId(ORG_B, "VIP")).toBe(deB);
  });
});
