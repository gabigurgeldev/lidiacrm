/**
 * Embed do PostgREST entre duas tabelas ligadas por uma "ponte" nomeia a FK.
 *
 * O PostgREST trata como muitos-para-muitos toda tabela cuja chave primária é
 * composta de colunas com FK para outras tabelas. Quando a migration 0229 criou
 * `coord_estado_conversa` com chave (organization_id, conversation_id), passaram
 * a existir DUAS relações entre `organizations` e `conversations` — a direta
 * (`conversations.organization_id`) e a ponte. Todo embed entre as duas sem o
 * nome da FK começou a falhar por ambiguidade, e a consulta inteira voltava
 * erro. No painel da plataforma, a lista de organizações mostrava "0 tenants".
 *
 * Nada no CI pegou: os testes de rota usam cliente falso, e o Postgres de
 * invariante não tem PostgREST. Por isso este teste lê o baseline, descobre as
 * pontes, e reprova embed sem FK nomeada entre os pares que elas ligam.
 *
 * Sabotagem medida: tirar `!conversations_organization_id_fkey` da lista de
 * tenants (app/api/v1/admin/tenants/route.ts) deixa o teste vermelho.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();
const PASTAS = ["app", "lib", "components", "hooks", "workers"];

function normalizar(nome: string): string {
  return nome.replace(/"/g, "").replace(/^public\./, "");
}

/** Pares de tabelas ligados por uma ponte (chave primária composta só de FKs). */
function pontesDoBaseline(sql: string): Array<{ ponte: string; a: string; b: string }> {
  const fks = new Map<string, Map<string, string>>(); // tabela -> coluna -> tabela referenciada
  const pks = new Map<string, string[]>();
  const fk = (tabela: string, coluna: string, ref: string) => {
    const m = fks.get(tabela) ?? new Map<string, string>();
    m.set(coluna, ref);
    fks.set(tabela, m);
  };

  // Estilo apêndice: create table ... ( col tipo ... references public.t(...), primary key (a, b) );
  for (const bloco of sql.matchAll(/create table (?:if not exists )?([\w."]+)\s*\(([\s\S]*?)\n\);/gi)) {
    const tabela = normalizar(bloco[1]!);
    const corpo = bloco[2]!;
    for (const col of corpo.matchAll(/^\s*"?(\w+)"?\s+[^,\n]*?references\s+([\w."]+)\s*\(/gim)) {
      fk(tabela, col[1]!, normalizar(col[2]!));
    }
    const pk = /primary key\s*\(([^)]+)\)/i.exec(corpo);
    if (pk) pks.set(tabela, pk[1]!.split(",").map((c) => c.replace(/"/g, "").trim()));
  }
  // Estilo dump: ALTER TABLE ... ADD CONSTRAINT ... PRIMARY KEY / FOREIGN KEY ... REFERENCES
  for (const m of sql.matchAll(/alter table (?:only )?([\w."]+)\s+add constraint [\w"]+ primary key \(([^)]+)\)/gi)) {
    pks.set(normalizar(m[1]!), m[2]!.split(",").map((c) => c.replace(/"/g, "").trim()));
  }
  for (const m of sql.matchAll(
    /alter table (?:only )?([\w."]+)\s+add constraint [\w"]+ foreign key \(([^)]+)\) references ([\w."]+)/gi,
  )) {
    const cols = m[2]!.split(",").map((c) => c.replace(/"/g, "").trim());
    if (cols.length === 1) fk(normalizar(m[1]!), cols[0]!, normalizar(m[3]!));
  }

  const pontes: Array<{ ponte: string; a: string; b: string }> = [];
  for (const [tabela, colunas] of pks) {
    if (colunas.length < 2) continue;
    const refs = colunas.map((c) => fks.get(tabela)?.get(c));
    if (refs.some((r) => r === undefined)) continue;
    const distintas = [...new Set(refs as string[])];
    for (let i = 0; i < distintas.length; i++) {
      for (let j = i + 1; j < distintas.length; j++) {
        pontes.push({ ponte: tabela, a: distintas[i]!, b: distintas[j]! });
      }
    }
  }
  return pontes;
}

function arquivos(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" || e.name.startsWith(".") ? [] : arquivos(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

/** `.from("origem")` seguido, no mesmo encadeamento, de um embed de `destino` sem `!fk`. */
function embedsSemFk(fonte: string, origem: string, destino: string): number[] {
  const linhas: number[] = [];
  const reFrom = new RegExp(`\\.from\\(\\s*["'\`]${origem}["'\`]\\s*\\)`, "g");
  for (const m of fonte.matchAll(reFrom)) {
    const resto = fonte.slice(m.index!, m.index! + 1500);
    const fim = resto.search(/;\s*\n|\.from\(/g) > 0 ? resto.slice(1).search(/;\s*\n|\.from\(/) + 1 : resto.length;
    const cadeia = resto.slice(0, fim);
    const sel = /\.select\(\s*([`"'])([\s\S]*?)\1/.exec(cadeia);
    if (!sel) continue;
    const embed = new RegExp(`(?<![\\w.])${destino}(?:!inner)?\\s*\\(`);
    if (embed.test(sel[2]!)) linhas.push(fonte.slice(0, m.index!).split("\n").length);
  }
  return linhas;
}

describe("embed entre tabelas ligadas por ponte nomeia a FK", () => {
  const sql = fs.readFileSync(path.join(RAIZ, "supabase/baseline.sql"), "utf8").replace(/\r\n/g, "\n");
  const pontes = pontesDoBaseline(sql);

  it("acha a ponte do coordenador (guarda de vacuidade)", () => {
    expect(pontes).toContainEqual(
      expect.objectContaining({ ponte: "coord_estado_conversa" }),
    );
    const par = pontes.find((p) => p.ponte === "coord_estado_conversa")!;
    expect([par.a, par.b].sort()).toEqual(["conversations", "organizations"]);
  });

  it("nenhum embed ambíguo no código", () => {
    const fontes = PASTAS.flatMap((p) => arquivos(path.join(RAIZ, p)));
    const achados: string[] = [];
    for (const arq of fontes) {
      const fonte = fs.readFileSync(arq, "utf8").replace(/\r\n/g, "\n");
      for (const { ponte, a, b } of pontes) {
        for (const [origem, destino] of [
          [a, b],
          [b, a],
        ] as const) {
          for (const linha of embedsSemFk(fonte, origem, destino)) {
            achados.push(`${path.relative(RAIZ, arq)}:${linha} — ${origem} → ${destino} (ponte: ${ponte})`);
          }
        }
      }
    }
    expect(
      achados,
      "embed sem FK nomeada entre tabelas que uma ponte liga: o PostgREST recusa por ambiguidade. " +
        "Use `destino!<nome_da_fk>(…)` — ex.: conversations!conversations_organization_id_fkey(count).",
    ).toEqual([]);
  });
});
