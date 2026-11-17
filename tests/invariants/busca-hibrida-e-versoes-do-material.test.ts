import { beforeAll, describe, expect, it } from "vitest";

import { GOV_ADMIN, GOV_ORG, columnExists, indexExists, seedGov, sql } from "./gov-helpers";

/**
 * Migration 0255 — busca híbrida, HNSW e versões do material atômicas e podadas.
 *
 * Medido contra o `baseline.sql` aplicado num Postgres real, que é o que o
 * self-hoster recebe. Cada promessa vem em PAR — o que deve acontecer acontece
 * E o que não deve não acontece —, senão uma tabela vazia deixaria tudo verde.
 *
 *  1. O texto acha o código que o vetor erra (SKU, número de pedido).
 *  2. A função híbrida não cruza organização, nem por parâmetro nem por papel.
 *  3. Ativar versão é atômico: uma ativa por fonte, ponteiro junto.
 *  4. Derivar copia a ativa menos o item que mudou, e recusa mapa diferente.
 *  5. A poda apaga versão velha e NUNCA a ativa, as duas mais recentes, a que
 *     está sendo construída ou a recente.
 */

const ORG_B = "eeeeeeee-0000-4000-8000-000000000002";

const FONTE_BUSCA = "eeeeeeee-1111-4000-8000-000000000001";
const FONTE_B = "eeeeeeee-1111-4000-8000-000000000002";
const FONTE_ATIVAR = "eeeeeeee-1111-4000-8000-000000000003";
const FONTE_DERIVAR = "eeeeeeee-1111-4000-8000-000000000004";
const FONTE_PODA = "eeeeeeee-1111-4000-8000-000000000005";

const V_BUSCA = "eeeeeeee-2222-4000-8000-000000000001";
const V_B = "eeeeeeee-2222-4000-8000-000000000002";
const V_ATIVAR_1 = "eeeeeeee-2222-4000-8000-000000000031";
const V_ATIVAR_2 = "eeeeeeee-2222-4000-8000-000000000032";
const V_DERIVAR_ATIVA = "eeeeeeee-2222-4000-8000-000000000041";
const V_DERIVAR_NOVA = "eeeeeeee-2222-4000-8000-000000000042";
const V_DERIVAR_OUTRO_MAPA = "eeeeeeee-2222-4000-8000-000000000043";
/** v1 recente, v2 em construção, v3 velha, v4 entre as duas últimas, v5 ativa. */
const V_PODA = [1, 2, 3, 4, 5].map((n) => `eeeeeeee-2222-4000-8000-00000000005${n}`);

/** Vetor de consulta: tudo positivo. */
const VETOR_A = `(select array_fill(0.1::real, array[1536])::vector)`;
/** Ortogonal ao A (cosseno 0): metade +1, metade -1. */
const VETOR_B = `(select (array_fill(1::real, array[768]) || array_fill(-1::real, array[768]))::vector)`;

function linhas(out: string): string[] {
  return out.split("\n").filter((l) => l.trim().length > 0);
}

function falha(script: string): string | null {
  try {
    sql(script);
    return null;
  } catch (err) {
    return String((err as { stderr?: string }).stderr ?? err);
  }
}

function seed(): void {
  sql(`
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG_B}', 'inv0255-b', 'Inv 0255 B', 'Inv 0255 B')
      on conflict (id) do nothing;

    insert into public.ai_knowledge_sources (id, organization_id, agent_id, source_type, name, status, is_active)
      values ('${FONTE_BUSCA}', '${GOV_ORG}', null, 'faq', 'Inv0255 busca', 'ready', true),
             ('${FONTE_B}', '${ORG_B}', null, 'faq', 'Inv0255 outra org', 'ready', true),
             ('${FONTE_ATIVAR}', '${GOV_ORG}', null, 'faq', 'Inv0255 ativar', 'ready', true),
             ('${FONTE_DERIVAR}', '${GOV_ORG}', null, 'catalog', 'Inv0255 derivar', 'ready', true),
             ('${FONTE_PODA}', '${GOV_ORG}', null, 'faq', 'Inv0255 poda', 'ready', true)
      on conflict do nothing;

    insert into public.ai_knowledge_versions
      (id, organization_id, agent_id, knowledge_source_id, version_number, status, is_active, created_at)
      values ('${V_BUSCA}', '${GOV_ORG}', null, '${FONTE_BUSCA}', 1, 'ready', true, now()),
             ('${V_B}', '${ORG_B}', null, '${FONTE_B}', 1, 'ready', true, now()),
             ('${V_ATIVAR_1}', '${GOV_ORG}', null, '${FONTE_ATIVAR}', 1, 'ready', true, now()),
             ('${V_ATIVAR_2}', '${GOV_ORG}', null, '${FONTE_ATIVAR}', 2, 'ready', false, now()),
             ('${V_DERIVAR_ATIVA}', '${GOV_ORG}', null, '${FONTE_DERIVAR}', 1, 'ready', true, now()),
             ('${V_DERIVAR_NOVA}', '${GOV_ORG}', null, '${FONTE_DERIVAR}', 2, 'building', false, now()),
             ('${V_DERIVAR_OUTRO_MAPA}', '${GOV_ORG}', null, '${FONTE_DERIVAR}', 3, 'building', false, now()),
             ('${V_PODA[0]}', '${GOV_ORG}', null, '${FONTE_PODA}', 1, 'ready', false, now()),
             ('${V_PODA[1]}', '${GOV_ORG}', null, '${FONTE_PODA}', 2, 'building', false, now() - interval '30 days'),
             ('${V_PODA[2]}', '${GOV_ORG}', null, '${FONTE_PODA}', 3, 'ready', false, now() - interval '30 days'),
             ('${V_PODA[3]}', '${GOV_ORG}', null, '${FONTE_PODA}', 4, 'ready', false, now() - interval '30 days'),
             ('${V_PODA[4]}', '${GOV_ORG}', null, '${FONTE_PODA}', 5, 'ready', true, now() - interval '30 days')
      on conflict do nothing;

    update public.ai_knowledge_sources set active_kb_version_id = '${V_BUSCA}' where id = '${FONTE_BUSCA}';
    update public.ai_knowledge_sources set active_kb_version_id = '${V_B}' where id = '${FONTE_B}';
    update public.ai_knowledge_sources set active_kb_version_id = '${V_ATIVAR_1}' where id = '${FONTE_ATIVAR}';
    update public.ai_knowledge_sources set active_kb_version_id = '${V_DERIVAR_ATIVA}' where id = '${FONTE_DERIVAR}';
    update public.ai_knowledge_sources set active_kb_version_id = '${V_PODA[4]}' where id = '${FONTE_PODA}';

    -- Busca: 30 trechos de enchimento colados no vetor da consulta, e UM trecho
    -- com o código, num vetor ortogonal. O vetor sozinho nunca o traz no top 5.
    insert into public.ai_chunks
      (organization_id, knowledge_source_id, kb_version_id, position, content, content_hash, token_count, embedding)
      select '${GOV_ORG}', '${FONTE_BUSCA}', '${V_BUSCA}', g, 'Politica geral de atendimento numero ' || g, 'inv0255-e' || g, 6, ${VETOR_A}
        from generate_series(1, 30) g;
    insert into public.ai_chunks
      (organization_id, knowledge_source_id, kb_version_id, position, content, content_hash, token_count, embedding)
      values ('${GOV_ORG}', '${FONTE_BUSCA}', '${V_BUSCA}', 0, 'Código do produto ABC123, tamanho único', 'inv0255-sku', 6, ${VETOR_B}),
             ('${ORG_B}', '${FONTE_B}', '${V_B}', 0, 'Código ABC123 da OUTRA organização', 'inv0255-b', 6, ${VETOR_A});

    -- Derivar: três produtos na versão ativa.
    insert into public.ai_chunks
      (organization_id, knowledge_source_id, kb_version_id, position, content, content_hash, token_count, embedding, metadata)
      values ('${GOV_ORG}', '${FONTE_DERIVAR}', '${V_DERIVAR_ATIVA}', 0, 'produto um', 'inv0255-p1', 2, ${VETOR_A}, '{"product_id":"p1"}'),
             ('${GOV_ORG}', '${FONTE_DERIVAR}', '${V_DERIVAR_ATIVA}', 1, 'produto dois', 'inv0255-p2', 2, ${VETOR_A}, '{"product_id":"p2"}'),
             ('${GOV_ORG}', '${FONTE_DERIVAR}', '${V_DERIVAR_ATIVA}', 2, 'produto tres', 'inv0255-p3', 2, ${VETOR_A}, '{"product_id":"p3"}');

    -- Poda: um trecho por versão.
    insert into public.ai_chunks
      (organization_id, knowledge_source_id, kb_version_id, position, content, content_hash, token_count, embedding)
      select '${GOV_ORG}', '${FONTE_PODA}', v.id, 0, 'trecho da versao ' || v.version_number, 'inv0255-poda' || v.version_number, 3, ${VETOR_A}
        from public.ai_knowledge_versions v where v.knowledge_source_id = '${FONTE_PODA}';
  `);
}

function buscar(org: string, fontes: string[], termos: string[], k = 5): string[] {
  const lista = fontes.map((f) => `'${f}'`).join(",");
  const t = termos.map((x) => `'${x}'`).join(",");
  return linhas(
    sql(`
      select content || '|' || coalesce(rank_vetor::text, '-') || '|' || coalesce(rank_texto::text, '-')
        from public.fn_buscar_trechos_hibrido('${org}', array[${lista}]::uuid[], ${VETOR_A}, array[${t}]::text[], ${k});
    `),
  );
}

beforeAll(() => {
  seedGov();
  seed();
});

describe("0255 — schema", () => {
  it("a coluna de texto e o índice GIN existem", () => {
    expect(columnExists("ai_chunks", "tsv")).toBe(true);
    expect(indexExists("ai_chunks_tsv_idx")).toBe(true);
  });

  it("com pgvector ≥ 0.5, o HNSW substitui o ivfflat", () => {
    const versao = sql(`select extversion from pg_extension where extname = 'vector';`);
    const [maior, menor] = versao.split(".").map(Number);
    if ((maior ?? 0) > 0 || (menor ?? 0) >= 5) {
      expect(indexExists("ai_chunks_embedding_hnsw_idx")).toBe(true);
      expect(indexExists("ai_chunks_embedding_ivfflat_idx")).toBe(false);
    } else {
      expect(indexExists("ai_chunks_embedding_ivfflat_idx")).toBe(true);
    }
  });

  it("knowledge_searches registra se houve rerank e quantos candidatos", () => {
    expect(columnExists("knowledge_searches", "reordenado")).toBe(true);
    expect(columnExists("knowledge_searches", "candidatos")).toBe(true);
  });
});

describe("0255 — a busca híbrida", () => {
  it("o texto acha o código que o vetor erra", () => {
    const r = buscar(GOV_ORG, [FONTE_BUSCA], ["abc123"]);
    const sku = r.find((l) => l.startsWith("Código do produto ABC123"));
    expect(sku, r.join("\n")).toBeDefined();
    // Veio só pela lista do texto: fora do top 5 do vetor, primeiro no texto.
    expect(sku?.endsWith("|-|1")).toBe(true);
  });

  it("sem termo, o mesmo trecho NÃO volta — é o texto que o traz", () => {
    const r = buscar(GOV_ORG, [FONTE_BUSCA], []);
    expect(r.length).toBe(5);
    expect(r.some((l) => l.includes("ABC123"))).toBe(false);
  });

  it("termo com operador de tsquery é descartado, não quebra a busca", () => {
    expect(() => buscar(GOV_ORG, [FONTE_BUSCA], ["abc|123", "x&y", "!"])).not.toThrow();
  });

  it("fonte de outra organização não entra, mesmo pedida por id", () => {
    const r = buscar(GOV_ORG, [FONTE_B], ["abc123"]);
    expect(r).toEqual([]);
    // Par positivo: na organização dona, o mesmo pedido acha.
    expect(buscar(ORG_B, [FONTE_B], ["abc123"]).length).toBe(1);
  });

  it("membro da org A não busca na org B pela função", () => {
    const erro = falha(`
      set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${GOV_ADMIN}"}', false);
      select count(*) from public.fn_buscar_trechos_hibrido('${ORG_B}', array['${FONTE_B}']::uuid[], ${VETOR_A}, array['abc123']::text[], 5);
    `);
    expect(erro).toMatch(/caller_not_authorized_for_org/);
    // Par positivo: na própria organização, o mesmo papel busca.
    const ok = sql(`
      set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${GOV_ADMIN}"}', false);
      select count(*) from public.fn_buscar_trechos_hibrido('${GOV_ORG}', array['${FONTE_BUSCA}']::uuid[], ${VETOR_A}, array['abc123']::text[], 5);
    `);
    expect(Number(linhas(ok).at(-1))).toBeGreaterThan(0);
  });

  it("anon não executa a função", () => {
    expect(
      sql(`select has_function_privilege('anon', 'public.fn_buscar_trechos_hibrido(uuid, uuid[], public.vector, text[], integer, text)', 'execute');`),
    ).toBe("f");
  });
});

describe("0255 — ativar versão é atômico", () => {
  it("ativa a nova, desativa a anterior e move o ponteiro", () => {
    sql(`select public.fn_ativar_versao_kb('${GOV_ORG}', '${FONTE_ATIVAR}', '${V_ATIVAR_2}');`);
    expect(
      sql(`select string_agg(version_number::text, ',') from public.ai_knowledge_versions where knowledge_source_id = '${FONTE_ATIVAR}' and is_active;`),
    ).toBe("2");
    expect(sql(`select active_kb_version_id from public.ai_knowledge_sources where id = '${FONTE_ATIVAR}';`)).toBe(V_ATIVAR_2);
  });

  it("versão de outra fonte é recusada e nada muda", () => {
    const erro = falha(`select public.fn_ativar_versao_kb('${GOV_ORG}', '${FONTE_ATIVAR}', '${V_BUSCA}');`);
    expect(erro).toMatch(/versao_nao_pertence_a_fonte/);
    expect(sql(`select active_kb_version_id from public.ai_knowledge_sources where id = '${FONTE_ATIVAR}';`)).toBe(V_ATIVAR_2);
    expect(sql(`select is_active from public.ai_knowledge_versions where id = '${V_BUSCA}';`)).toBe("t");
  });

  it("só service_role executa", () => {
    expect(sql(`select has_function_privilege('authenticated', 'public.fn_ativar_versao_kb(uuid, uuid, uuid)', 'execute');`)).toBe("f");
    expect(sql(`select has_function_privilege('anon', 'public.fn_ativar_versao_kb(uuid, uuid, uuid)', 'execute');`)).toBe("f");
  });
});

describe("0255 — derivar a versão nova da ativa", () => {
  it("copia tudo menos o item que mudou, com posições contíguas", () => {
    const n = sql(`select public.fn_derivar_versao_kb('${GOV_ORG}', '${FONTE_DERIVAR}', '${V_DERIVAR_NOVA}', 'product_id', array['p2']);`);
    expect(n).toBe("2");
    expect(
      sql(`select string_agg((metadata->>'product_id') || '@' || position, ',' order by position) from public.ai_chunks where kb_version_id = '${V_DERIVAR_NOVA}';`),
    ).toBe("p1@0,p3@1");
    // A ativa continua inteira.
    expect(sql(`select count(*) from public.ai_chunks where kb_version_id = '${V_DERIVAR_ATIVA}';`)).toBe("3");
  });

  it("recusa copiar para uma versão de outro modelo de embedding", () => {
    sql(`
      update public.ai_knowledge_versions set embedding_model = 'modelo-a' where id = '${V_DERIVAR_ATIVA}';
      update public.ai_knowledge_versions set embedding_model = 'modelo-b' where id = '${V_DERIVAR_OUTRO_MAPA}';
    `);
    const erro = falha(`select public.fn_derivar_versao_kb('${GOV_ORG}', '${FONTE_DERIVAR}', '${V_DERIVAR_OUTRO_MAPA}', 'product_id', array['p2']);`);
    expect(erro).toMatch(/mapa_de_embedding_diferente/);
    expect(sql(`select count(*) from public.ai_chunks where kb_version_id = '${V_DERIVAR_OUTRO_MAPA}';`)).toBe("0");
  });

  it("recusa versão que não está em construção", () => {
    const erro = falha(`select public.fn_derivar_versao_kb('${GOV_ORG}', '${FONTE_DERIVAR}', '${V_DERIVAR_ATIVA}', 'product_id', array['p2']);`);
    expect(erro).toMatch(/versao_nova_invalida/);
  });
});

describe("0255 — a poda das versões antigas", () => {
  it("apaga só a versão velha, inativa e fora das duas últimas", () => {
    const apagados = Number(sql(`select public.fn_expurgar_versoes_do_material(7, 1000);`));
    expect(apagados).toBeGreaterThanOrEqual(1);
    const restantes = sql(`
      select string_agg(v.version_number::text || '=' || (select count(*) from public.ai_chunks c where c.kb_version_id = v.id), ',' order by v.version_number)
        from public.ai_knowledge_versions v where v.knowledge_source_id = '${FONTE_PODA}';
    `);
    // v1 recente, v2 em construção, v4 entre as duas últimas, v5 ativa: ficam.
    expect(restantes).toBe("1=1,2=1,3=0,4=1,5=1");
  });

  it("o piso de 1 dia vale mesmo pedindo zero", () => {
    // v1 tem segundos de idade: nem com 0 dias ela sai.
    sql(`select public.fn_expurgar_versoes_do_material(0, 1000);`);
    expect(sql(`select count(*) from public.ai_chunks where kb_version_id = '${V_PODA[0]}';`)).toBe("1");
  });

  it("só service_role executa", () => {
    expect(sql(`select has_function_privilege('authenticated', 'public.fn_expurgar_versoes_do_material(int, int)', 'execute');`)).toBe("f");
    expect(sql(`select has_function_privilege('anon', 'public.fn_expurgar_versoes_do_material(int, int)', 'execute');`)).toBe("f");
  });
});
