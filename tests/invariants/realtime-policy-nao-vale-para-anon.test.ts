import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * UMA ASSINATURA ANÔNIMA NÃO PODE PARAR O TEMPO REAL DE TODO MUNDO (migration 0252).
 *
 * `realtime.list_changes` avalia a policy de SELECT de cada assinatura dentro de
 * UMA consulta. Se a policy vale para PUBLIC e chama uma definer de que anon não
 * tem EXECUTE (todas as das tabelas publicadas chamam — a varredura da 0116 tira
 * anon de toda definer), a assinatura anônima não recebe "zero linhas": a
 * consulta inteira ERRA, e nenhuma organização recebe evento enquanto ela existir.
 * Medido em produção, com o erro `permission denied for function
 * fn_can_view_conversation` coincidindo minuto a minuto com a VPS saturada.
 *
 * Este arquivo cobra as duas metades: a regra no catálogo (nenhuma policy de
 * tabela publicada vale para PUBLIC/anon) e o comportamento que ela compra
 * (anon lê zero linhas, sem erro). E prova que o bloco do baseline CURA uma
 * policy recriada sem `to authenticated` — é ele que corre em todo `update.sh`.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db`");
const containerName: string = container;

function sql(script: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", containerName, "psql", "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-tA", "-f", "-"],
    { input: script, encoding: "utf8" },
  ).trim();
}

/** Policies de tabela publicada que valem para PUBLIC ou anon — a violação. */
const SONDA_VIOLACOES = `
  select c.relname || '.' || pol.polname
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_publication_tables t
      on t.pubname = 'supabase_realtime' and t.schemaname = n.nspname and t.tablename = c.relname
   where n.nspname = 'public'
     and (0::oid = any (pol.polroles) or 'anon'::regrole::oid = any (pol.polroles))
   order by 1;
`;

function linhas(saida: string): string[] {
  return saida.split("\n").map((s) => s.trim()).filter(Boolean);
}

/** O bloco "regra 3" do apêndice final do baseline — o que o update.sh executa. */
function blocoDoBaseline(): string {
  const baseline = readFileSync(join(process.cwd(), "supabase", "baseline.sql"), "utf8");
  const inicio = baseline.indexOf("-- regra 3 (migration 0252)");
  const fim = baseline.indexOf("notify pgrst", inicio);
  if (inicio < 0 || fim < 0) throw new Error("bloco da regra 3 (migration 0252) não achado no baseline.sql");
  return baseline.slice(inicio, fim);
}

describe("policy de tabela publicada no Realtime não vale para anon", () => {
  it("a sonda enxerga tabelas e policies (guarda de vacuidade)", () => {
    const publicadas = Number(
      sql(`select count(*) from pg_publication_tables where pubname='supabase_realtime' and schemaname='public';`),
    );
    const policies = Number(
      sql(`
        select count(*) from pg_policy pol
          join pg_class c on c.oid = pol.polrelid
          join pg_publication_tables t
            on t.pubname = 'supabase_realtime' and t.schemaname = 'public' and t.tablename = c.relname;
      `),
    );
    expect(publicadas).toBeGreaterThan(5);
    expect(policies).toBeGreaterThan(10);
  });

  it("nenhuma policy de tabela publicada vale para PUBLIC ou anon", () => {
    expect(
      linhas(sql(SONDA_VIOLACOES)),
      "policy de tabela publicada no Realtime vale para PUBLIC/anon — uma assinatura anônima\n" +
        "derruba o realtime.list_changes de todas as organizações. Crie a policy com `to authenticated`.",
    ).toEqual([]);
  });

  it.each(["conversations", "messages", "crm_leads"])(
    "anon lendo %s recebe zero linhas, não erro",
    (tabela) => {
      // Antes da 0252: `permission denied for function ...` — e o ON_ERROR_STOP
      // faria o execFileSync lançar aqui.
      const saida = sql(`
        begin;
        set local role anon;
        select count(*) from public.${tabela};
        rollback;
      `);
      expect(linhas(saida).filter((l) => /^\d+$/.test(l))).toEqual(["0"]);
    },
  );

  it("a sonda acusa uma policy nova sem `to` (controle negativo)", () => {
    const saida = sql(`
      begin;
      create policy sabotagem_0252 on public.conversations
        for select using (public.fn_is_platform_admin());
      ${SONDA_VIOLACOES}
      rollback;
    `);
    expect(linhas(saida)).toContain("conversations.sabotagem_0252");
  });

  it("o bloco do baseline cura a policy recriada sem `to` — é ele que corre no update.sh", () => {
    const saida = sql(`
      begin;
      create policy sabotagem_0252 on public.conversations
        for select using (public.fn_is_platform_admin());
      ${blocoDoBaseline()}
      ${SONDA_VIOLACOES}
      select 'roles=' || array_to_string(
        array(select r.rolname from pg_policy pol, unnest(pol.polroles) x join pg_roles r on r.oid = x
               where pol.polname = 'sabotagem_0252'), ',');
      rollback;
    `);
    const l = linhas(saida);
    expect(l, "o bloco não curou a policy sabotada").not.toContain("conversations.sabotagem_0252");
    expect(l).toContain("roles=authenticated");
  });
});
