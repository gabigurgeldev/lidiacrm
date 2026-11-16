/**
 * Toda origem que o código grava em `org_memory_entries.source` cabe no CHECK
 * que o self-hoster recebe (supabase/baseline.sql).
 *
 * O defeito que isto vigia: `crm_save_org_memory` gravava `source='agent'` e o
 * CHECK da 0067 só aceitava 'manual'/'flywheel' — toda chamada da ferramenta
 * morria com 23514, e nenhum teste unitário via, porque o insert passa pelo
 * PostgREST e o mock aceita qualquer coisa. Corrigido na 0254.
 *
 * O CHECK vigente é o ÚLTIMO `org_memory_entries_source_check` do baseline (o
 * apêndice recria a constraint; a definição da 0067 fica no dump, acima).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const raiz = path.resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(path.join(raiz, rel), "utf8");

/** Quem insere em org_memory_entries, e a origem que cada um grava. */
const ESCRITORES = [
  "lib/mcp/tools/evolucao.ts",
  "lib/ai/apply-proposal.ts",
  "app/api/v1/ai/memory/entries/route.ts",
];

function origensDoCheckVigente(): string[] {
  const sql = ler("supabase/baseline.sql");
  const achados = [
    ...sql.matchAll(/org_memory_entries_source_check\s+check\s*\(\s*source\s+in\s*\(([^)]*)\)/gi),
  ];
  const ultimo = achados.at(-1);
  if (!ultimo) throw new Error("org_memory_entries_source_check não achado no baseline.sql");
  return [...ultimo[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

function origensGravadas(arquivo: string): string[] {
  const fonte = ler(arquivo);
  // Só o trecho que insere na tabela — `source:` aparece em outros contextos.
  const blocos = fonte.split(/\.from\(\s*["']org_memory_entries["']\s*\)/).slice(1);
  return blocos.flatMap((b) => {
    const insert = b.split(/\.select\(/)[0];
    if (!/\.insert\(/.test(insert)) return [];
    return [...insert.matchAll(/source:\s*["']([^"']+)["']/g)].map((m) => m[1]);
  });
}

describe("org_memory_entries.source: código x CHECK do baseline", () => {
  const permitidas = origensDoCheckVigente();

  it("o CHECK vigente aceita as três origens conhecidas", () => {
    expect(permitidas.sort()).toEqual(["agent", "flywheel", "manual"]);
  });

  for (const arquivo of ESCRITORES) {
    it(`${arquivo} só grava origem que o CHECK aceita`, () => {
      const gravadas = origensGravadas(arquivo);
      expect(gravadas.length, `nenhum insert com source achado em ${arquivo}`).toBeGreaterThan(0);
      for (const origem of gravadas) expect(permitidas).toContain(origem);
    });
  }
});
