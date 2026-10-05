/**
 * `ai_api_integrations` e `ai_api_endpoints` têm FK nos DOIS sentidos
 * (`ai_api_endpoints.integration_id` e `ai_api_integrations.identidade_endpoint_id`).
 * Um embed PostgREST sem dizer qual FK usar responde `300 PGRST201` — e a lista
 * de integrações, as telas do agente e o escopo da versão quebram com 500.
 * Medido em produção: o CI não tem PostgREST, e nada mais pegava isto.
 *
 * Regra: todo embed entre as duas tabelas nomeia a FK
 * (`ai_api_endpoints!ai_api_endpoints_integration_id_fkey(...)`).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZES = ["app", "lib", "components", "workers"];
const EMBED_SEM_FK = /\b(ai_api_endpoints|ai_api_integrations)(?:!inner)?\s*\(/g;

function arquivos(dir: string): string[] {
  let out: string[] = [];
  let nomes: string[];
  try {
    nomes = readdirSync(dir);
  } catch {
    return out;
  }
  for (const n of nomes) {
    if (n === "node_modules" || n.startsWith(".")) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out = out.concat(arquivos(p));
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}

describe("embed entre integrações e endpoints nomeia a FK", () => {
  it("nenhum select usa ai_api_endpoints(...) ou ai_api_integrations(...) sem !<fk>", () => {
    const achados: string[] = [];
    for (const raiz of RAIZES) {
      for (const f of arquivos(raiz)) {
        const linhas = readFileSync(f, "utf8").split(/\r?\n/);
        linhas.forEach((l, i) => {
          for (const m of l.matchAll(EMBED_SEM_FK)) {
            // `.from("ai_api_endpoints")` não é embed; só conta dentro de string de select.
            const antes = l.slice(0, m.index);
            if (/\.from\(\s*["'`]$/.test(antes)) continue;
            achados.push(`${f}:${i + 1}: ${l.trim()}`);
          }
        });
      }
    }
    expect(achados).toEqual([]);
  });

  it("o padrão pega a forma que quebrou em produção", () => {
    expect("x, ai_api_endpoints(id, modo, ativo)".match(EMBED_SEM_FK)).not.toBeNull();
    expect("id, ai_api_integrations!inner(arquivada_em)".match(EMBED_SEM_FK)).not.toBeNull();
    expect("x, ai_api_endpoints!ai_api_endpoints_integration_id_fkey(id)".match(EMBED_SEM_FK)).toBeNull();
  });
});
