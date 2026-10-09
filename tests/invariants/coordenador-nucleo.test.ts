import { beforeAll, describe, expect, it } from "vitest";

import { countAs, lastLine, sql } from "./gov-helpers";

/**
 * O que a migration 0229 promete, cobrado no banco que o CLONE recebe
 * (`supabase/baseline.sql` num Postgres descartável).
 *
 *  1. Isolamento: membro da org A lê o estado/diário da A e não os da B; e o
 *     cliente NÃO escreve (só o service role transiciona).
 *  2. Integridade entre orgs: destino/dono apontando para agente de outra org
 *     é recusado pelo banco, não só pelo código.
 *  3. CAS: transição com versão velha é `conflito` e fica no diário como
 *     `obsoleta` — duas decisões concorrentes não se sobrepõem.
 *  4. Outbox: troca aceita e evento de despacho nascem na mesma transação.
 *  5. Prioridade humana: conversa pausada/assumida por qualquer caminho vira
 *     `pessoa` e a geração sobe; só ação `manual` tira de pessoa.
 *  6. Fencing: `fn_coord_pode_falar` recusa geração velha e executor que não é
 *     o dono; sem estado, o legado decide.
 *  7. Admissão idempotente: a segunda admissão da mesma mensagem devolve a
 *     primeira.
 *  8. Publicação: número sequencial, ponteiro na última, versão imutável.
 *  9. Anon e authenticated não executam as RPCs.
 */

const ORG_A = "0229aaaa-0000-4000-8000-000000000001";
const ORG_B = "0229bbbb-0000-4000-8000-000000000002";
const MEMBRO_A = "0229aaaa-1111-4000-8000-000000000001";
const SESSAO_A = "0229aaaa-2222-4000-8000-000000000001";
const SESSAO_B = "0229bbbb-2222-4000-8000-000000000002";
// Segundo número da org A: a mesma pessoa em dois números são duas conversas
// (o baseline garante uma conversa por contato e número).
const SESSAO_A2 = "0229aaaa-2222-4000-8000-000000000002";
const CONTATO_A = "0229aaaa-3333-4000-8000-000000000001";
const CONTATO_B = "0229bbbb-3333-4000-8000-000000000002";
const CONV_A = "0229aaaa-4444-4000-8000-000000000001";
const CONV_A2 = "0229aaaa-4444-4000-8000-000000000002";
const CONV_B = "0229bbbb-4444-4000-8000-000000000002";
const AGENTE_A = "0229aaaa-5555-4000-8000-000000000001";
const AGENTE_A2 = "0229aaaa-5555-4000-8000-000000000002";
const AGENTE_B = "0229bbbb-5555-4000-8000-000000000002";
const MSG_A = "0229aaaa-6666-4000-8000-000000000001";
const MSG_B = "0229bbbb-6666-4000-8000-000000000002";

function seed(): void {
  sql(`
    insert into auth.users (id, email) values ('${MEMBRO_A}', 'coord-a@invariant.test');
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'coord-inv-a', 'Coord Inv A', 'Coord A'),
      ('${ORG_B}', 'coord-inv-b', 'Coord Inv B', 'Coord B');
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${MEMBRO_A}', '${ORG_A}', 'admin', now());
    insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted) values
      ('${SESSAO_A}', '${ORG_A}', 'coord-inv-a', '\\x00'::bytea),
      ('${SESSAO_A2}', '${ORG_A}', 'coord-inv-a2', '\\x00'::bytea),
      ('${SESSAO_B}', '${ORG_B}', 'coord-inv-b', '\\x00'::bytea);
    insert into public.contacts (id, organization_id, display_name) values
      ('${CONTATO_A}', '${ORG_A}', 'Cliente A'),
      ('${CONTATO_B}', '${ORG_B}', 'Cliente B');
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status) values
      ('${CONV_A}',  '${ORG_A}', '${CONTATO_A}', '${SESSAO_A}', 'open'),
      ('${CONV_A2}', '${ORG_A}', '${CONTATO_A}', '${SESSAO_A2}', 'open'),
      ('${CONV_B}',  '${ORG_B}', '${CONTATO_B}', '${SESSAO_B}', 'open');
    insert into public.ai_agents (id, organization_id, name, system_prompt) values
      ('${AGENTE_A}',  '${ORG_A}', 'Comercial A', 'prompt'),
      ('${AGENTE_A2}', '${ORG_A}', 'Suporte A', 'prompt'),
      ('${AGENTE_B}',  '${ORG_B}', 'Comercial B', 'prompt');
    insert into public.messages (id, organization_id, conversation_id, channel_session_id, contact_id, type, direction)
      values ('${MSG_A}', '${ORG_A}', '${CONV_A}', '${SESSAO_A}', '${CONTATO_A}', 'text', 'inbound');
  `);
}

function json(script: string): Record<string, unknown> {
  return JSON.parse(lastLine(sql(script))) as Record<string, unknown>;
}

function transicionar(conversa: string, versao: number, agente: string, categoria = "modelo", org = ORG_A): Record<string, unknown> {
  return json(`
    select public.fn_coord_transicionar(
      '${org}', '${conversa}', ${versao}, 'agente', '${agente}', null, null, null,
      'ativo', '${categoria}', 'primeira_mensagem_modelo', null, null, null,
      '{"event_type":"ai_agent.dispatch_requested","payload":{"origem":"teste"}}'::jsonb,
      '{}'::jsonb
    )::text;
  `);
}

function erro(script: string): string {
  try {
    sql(script);
  } catch (e) {
    const err = e as { stderr?: Buffer | string; message?: string };
    return String(err.stderr ?? "") + String(err.message ?? "");
  }
  return "";
}

describe("0229 · núcleo do coordenador", () => {
  beforeAll(() => {
    seed();
  });

  it("as sete tabelas nascem com RLS ligada", () => {
    const out = sql(`
      select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relrowsecurity
         and c.relname in ('coord_politica_versoes','coord_politica_destinos','coord_politica_ponteiros',
                           'coord_estado_conversa','coord_chamadas','coord_admissoes','coord_transicoes');
    `);
    expect(lastLine(out)).toBe("7");
  });

  it("transição nova: versão 1, geração 1, e o despacho nasce no event_log na mesma transação", () => {
    const r = transicionar(CONV_A, 0, AGENTE_A);
    expect(r).toMatchObject({ ok: true, versao: 1, geracao: 1 });
    const payload = lastLine(
      sql(`select payload::text from public.event_log where id = '${String(r.evento_id)}';`),
    );
    expect(JSON.parse(payload)).toMatchObject({ origem: "teste", coord_geracao: 1, coord_versao: 1 });
  });

  it("CAS: versão velha é conflito, não sobrescreve, e fica no diário como obsoleta", () => {
    const r = transicionar(CONV_A, 0, AGENTE_A2);
    expect(r).toMatchObject({ ok: false, motivo: "conflito", versao: 1 });
    expect(lastLine(sql(`select dono_agent_id from public.coord_estado_conversa where conversation_id = '${CONV_A}';`))).toBe(AGENTE_A);
    expect(
      lastLine(sql(`select count(*) from public.coord_transicoes where conversation_id = '${CONV_A}' and status = 'obsoleta';`)),
    ).toBe("1");
  });

  it("fencing: dono na geração atual fala; geração velha e outro executor não; sem estado, o legado decide", () => {
    const pode = (agente: string, geracao: number, conv = CONV_A) =>
      json(`select public.fn_coord_pode_falar('${ORG_A}', '${conv}', 'agente', '${agente}', ${geracao})::text;`);
    expect(pode(AGENTE_A, 1)).toMatchObject({ pode: true, motivo: "dono_atual" });
    expect(pode(AGENTE_A, 0)).toMatchObject({ pode: false, motivo: "geracao_obsoleta" });
    expect(pode(AGENTE_A2, 1)).toMatchObject({ pode: false, motivo: "nao_e_o_dono" });
    expect(pode(AGENTE_A, 0, CONV_A2)).toMatchObject({ pode: true, motivo: "sem_coordenacao" });
  });

  it("integridade entre orgs: dono de outra organização é recusado pelo banco", () => {
    const e = erro(`
      select public.fn_coord_transicionar(
        '${ORG_A}', '${CONV_A}', 1, 'agente', '${AGENTE_B}', null, null, null,
        'ativo', 'modelo', 'x', null, null, null, null, '{}'::jsonb);
    `);
    expect(e).toContain("coord_referencia_de_outra_organizacao");
    expect(lastLine(sql(`select versao from public.coord_estado_conversa where conversation_id = '${CONV_A}';`))).toBe("1");
  });

  it("prioridade humana: pausar a conversa vira `pessoa` e sobe a geração; só ação manual tira de pessoa", () => {
    sql(`update public.conversations set bot_silenced_until = 'infinity' where id = '${CONV_A}';`);
    const estado = lastLine(
      sql(`select dono_tipo || '|' || geracao || '|' || versao from public.coord_estado_conversa where conversation_id = '${CONV_A}';`),
    );
    expect(estado).toBe("pessoa|2|2");
    // O executor antigo perdeu a fala.
    expect(json(`select public.fn_coord_pode_falar('${ORG_A}', '${CONV_A}', 'agente', '${AGENTE_A}', 1)::text;`)).toMatchObject({
      pode: false,
      motivo: "pessoa_no_comando",
    });
    // Modelo / retorno atrasado não tiram de pessoa.
    expect(transicionar(CONV_A, 2, AGENTE_A, "modelo")).toMatchObject({ ok: false, motivo: "prioridade_humana" });
    expect(transicionar(CONV_A, 2, AGENTE_A, "retorno")).toMatchObject({ ok: false, motivo: "prioridade_humana" });
    // Ação manual (equipe devolveu) tira.
    expect(transicionar(CONV_A, 2, AGENTE_A, "manual")).toMatchObject({ ok: true, versao: 3, geracao: 3 });
  });

  it("contato travado para humano: todas as conversas coordenadas dele viram `pessoa`", () => {
    transicionar(CONV_A2, 0, AGENTE_A2);
    sql(`update public.contacts set force_human = true where id = '${CONTATO_A}';`);
    const donos = sql(`
      select dono_tipo from public.coord_estado_conversa
       where contact_id = '${CONTATO_A}' order by conversation_id;
    `).split("\n");
    expect(donos).toEqual(["pessoa", "pessoa"]);
    sql(`update public.contacts set force_human = false where id = '${CONTATO_A}';`);
  });

  it("admissão idempotente: a segunda vez devolve a primeira", () => {
    const a = (consumidor: string) =>
      json(
        `select public.fn_coord_admitir('${ORG_A}', '${MSG_A}', '${CONV_A}', 'agente', '${consumidor}', 'p1', 3)::text;`,
      );
    expect(a(AGENTE_A)).toMatchObject({ ja_admitida: false, consumidor_id: AGENTE_A });
    expect(a(AGENTE_A2)).toMatchObject({ ja_admitida: true, consumidor_id: AGENTE_A });
  });

  it("publicação: número sequencial, ponteiro na última, versão e destinos imutáveis", () => {
    const pub = (modo: string) =>
      json(`
        select public.fn_coord_publicar_politica(
          '${ORG_A}', null, '${modo}', '{}'::jsonb,
          '[{"chave":"comercial","tipo":"agente","agent_id":"${AGENTE_A}","quando_usar":"planos"}]'::jsonb,
          null)::text;
      `);
    const v1 = pub("shadow");
    const v2 = pub("active");
    expect(v1).toMatchObject({ ok: true, numero: 1 });
    expect(v2).toMatchObject({ ok: true, numero: 2 });
    expect(
      lastLine(sql(`select versao_id from public.coord_politica_ponteiros where organization_id = '${ORG_A}' and channel_session_id is null;`)),
    ).toBe(String(v2.versao_id));
    expect(erro(`update public.coord_politica_versoes set modo = 'off' where id = '${String(v1.versao_id)}';`)).toContain("imutável");
    expect(erro(`update public.coord_politica_destinos set quando_usar = 'x' where versao_id = '${String(v1.versao_id)}';`)).toContain(
      "imutável",
    );
  });

  it("destino de outra organização é recusado na publicação", () => {
    const e = erro(`
      select public.fn_coord_publicar_politica('${ORG_A}', null, 'shadow', '{}'::jsonb,
        '[{"chave":"intruso","tipo":"agente","agent_id":"${AGENTE_B}"}]'::jsonb, null);
    `);
    expect(e).toContain("coord_referencia_de_outra_organizacao");
  });

  it("isolamento: o membro da A lê o diário da A e não o da B, e não escreve", () => {
    transicionar(CONV_B, 0, AGENTE_B, "modelo", ORG_B);
    expect(countAs(MEMBRO_A, `select count(*) from public.coord_transicoes where organization_id = '${ORG_A}'`)).toBeGreaterThan(0);
    expect(countAs(MEMBRO_A, `select count(*) from public.coord_transicoes where organization_id = '${ORG_B}'`)).toBe(0);
    expect(countAs(MEMBRO_A, `select count(*) from public.coord_estado_conversa where organization_id = '${ORG_B}'`)).toBe(0);
    const e = erro(`
      set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${MEMBRO_A}"}', false);
      update public.coord_estado_conversa set geracao = 999 where organization_id = '${ORG_A}';
    `);
    expect(e).toContain("permission denied");
  });

  it("as SETE tabelas: o membro da A vê as linhas da A e nenhuma da B; e não escreve em nenhuma", () => {
    // Linhas nas duas orgs em toda tabela — sem isso, "zero da B" passaria por
    // não haver dado nenhum para vazar.
    for (const [org, agente, conv, msg] of [
      [ORG_A, AGENTE_A, CONV_A2, null],
      [ORG_B, AGENTE_B, CONV_B, MSG_B],
    ] as const) {
      sql(`
        select public.fn_coord_publicar_politica('${org}', null, 'shadow', '{}'::jsonb,
          '[{"chave":"comercial","tipo":"agente","agent_id":"${agente}"}]'::jsonb, null);
        insert into public.coord_chamadas
          (organization_id, conversation_id, modalidade, origem_tipo, origem_agent_id, destino_tipo,
           destino_agent_id, prazo, geracao_origem, chave_idempotencia)
        values ('${org}', '${conv}', 'retorno', 'agente', '${agente}', 'agente', '${agente}',
                now() + interval '1 day', 1, 'inv-${org}');
      `);
      if (msg) {
        sql(`
          insert into public.messages (id, organization_id, conversation_id, channel_session_id, contact_id, type, direction)
            values ('${msg}', '${org}', '${conv}', '${SESSAO_B}', '${CONTATO_B}', 'text', 'inbound');
          select public.fn_coord_admitir('${org}', '${msg}', '${conv}', 'agente', '${agente}', null, 1);
        `);
      }
    }
    const tabelas = [
      "coord_politica_versoes",
      "coord_politica_destinos",
      "coord_politica_ponteiros",
      "coord_estado_conversa",
      "coord_chamadas",
      "coord_admissoes",
      "coord_transicoes",
    ];
    for (const t of tabelas) {
      expect(countAs(MEMBRO_A, `select count(*) from public.${t} where organization_id = '${ORG_A}'`), `${t}: controle`).toBeGreaterThan(0);
      expect(countAs(MEMBRO_A, `select count(*) from public.${t} where organization_id = '${ORG_B}'`), `${t}: vazou`).toBe(0);
      expect(countAs(MEMBRO_A, `select count(*) from public.${t}`), `${t}: tabela inteira`).toBe(
        countAs(MEMBRO_A, `select count(*) from public.${t} where organization_id = '${ORG_A}'`),
      );
      const e = erro(`
        set role authenticated;
        select set_config('request.jwt.claims', '{"sub":"${MEMBRO_A}"}', false);
        delete from public.${t} where organization_id = '${ORG_A}';
      `);
      expect(e, `${t}: o cliente apagou`).toContain("permission denied");
    }
  });

  it("anon e authenticated não executam as RPCs do coordenador", () => {
    const out = sql(`
      select string_agg(p.proname || ':' || has_function_privilege('anon', p.oid, 'EXECUTE')::text
                        || ':' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text, ',' order by p.proname)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname like 'fn_coord_%';
    `);
    for (const item of lastLine(out).split(",")) {
      expect(item, item).toMatch(/:false:false$/);
    }
  });
});
