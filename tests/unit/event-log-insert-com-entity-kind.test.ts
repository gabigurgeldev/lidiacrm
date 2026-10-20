import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * TODO INSERT DIRETO EM `event_log` LEVA `entity_kind`.
 *
 * ─── O defeito, medido (2026-10-20) ─────────────────────────────────────────
 *
 * `event_log.entity_kind` é `NOT NULL` desde o baseline, e sete pontos do
 * código inseriam sem ele: `ai_agent.published` (rota de publish, salvar e
 * reverter versão), `ai_agent.created` (onboarding e construtor) e
 * `tenant.onboarded` (onboarding e cadastro). Os sete falhavam com 23502 em TODA
 * chamada, numa instalação qualquer — reproduzido em produção pelo PostgREST.
 * Ninguém viu porque o admin client é `SupabaseClient` sem o tipo `Database`:
 * o `entity_kind: string` obrigatório de `lib/database.types.ts` não chega ao
 * compilador, e o erro voltava num `{ error }` que ou era ignorado ou virava
 * `console.error`.
 *
 * Os sete foram REMOVIDOS, não completados: nenhum handler escuta esses três
 * tipos, e completar o insert faria nascer evento sem consumidor (anti-pattern
 * 3 do CLAUDE.md) que fica `pending` para sempre. O fato de cada um já está no
 * `api_audit_log`.
 *
 * ─── O que este guarda cobre ────────────────────────────────────────────────
 *
 * Como o compilador não cobra, quem cobra é este arquivo: percorre o AST de
 * `app/`, `lib/`, `workers/` e `hooks/` e reprova `.from("event_log").insert(…)`
 * cujo argumento é objeto literal (ou array de objetos literais) sem a chave
 * `entity_kind`. Argumento que não é literal não é julgado — e a lista deles é
 * conferida contra uma allowlist que só encolhe, para o buraco não crescer calado.
 */

const RAIZ = join(__dirname, "..", "..");
const PASTAS = ["app", "lib", "workers", "hooks"];

function arquivosTs(dir: string): string[] {
  let saida: string[] = [];
  let entradas;
  try {
    entradas = readdirSync(dir, { withFileTypes: true });
  } catch {
    return saida;
  }
  for (const e of entradas) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const caminho = join(dir, e.name);
    if (e.isDirectory()) saida = saida.concat(arquivosTs(caminho));
    else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)) saida.push(caminho);
  }
  return saida;
}

/** `x.from("event_log")` — a chamada que abre a cadeia. */
function ehFromEventLog(no: ts.Expression): boolean {
  return (
    ts.isCallExpression(no) &&
    ts.isPropertyAccessExpression(no.expression) &&
    no.expression.name.text === "from" &&
    no.arguments.length === 1 &&
    ts.isStringLiteralLike(no.arguments[0]!) &&
    no.arguments[0]!.text === "event_log"
  );
}

function temEntityKind(obj: ts.ObjectLiteralExpression): boolean {
  return obj.properties.some(
    (p) =>
      ts.isSpreadAssignment(p) ||
      ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
        ts.isIdentifier(p.name) &&
        p.name.text === "entity_kind"),
  );
}

export interface Achado {
  linha: number;
  tipo: "ok" | "sem_entity_kind" | "nao_literal";
}

/** Todo insert em `event_log` no fonte dado, classificado. */
export function insertsEmEventLog(fonte: string, nomeDoArquivo: string): Achado[] {
  const arquivo = ts.createSourceFile(nomeDoArquivo, fonte, ts.ScriptTarget.Latest, true);
  const achados: Achado[] = [];

  const visitar = (no: ts.Node): void => {
    if (
      ts.isCallExpression(no) &&
      ts.isPropertyAccessExpression(no.expression) &&
      no.expression.name.text === "insert" &&
      ehFromEventLog(no.expression.expression)
    ) {
      const linha = arquivo.getLineAndCharacterOfPosition(no.getStart()).line + 1;
      const arg = no.arguments[0];
      const objetos =
        arg && ts.isObjectLiteralExpression(arg)
          ? [arg]
          : arg && ts.isArrayLiteralExpression(arg) && arg.elements.every(ts.isObjectLiteralExpression)
            ? (arg.elements as ts.NodeArray<ts.ObjectLiteralExpression>)
            : null;
      if (objetos === null) achados.push({ linha, tipo: "nao_literal" });
      else achados.push({ linha, tipo: objetos.every(temEntityKind) ? "ok" : "sem_entity_kind" });
    }
    ts.forEachChild(no, visitar);
  };
  visitar(arquivo);
  return achados;
}

/**
 * Inserts com argumento não literal, que este guarda não consegue julgar.
 * Só encolhe: quem converter um deles para literal, tira daqui.
 */
const NAO_LITERAIS_CONHECIDOS = new Set<string>([]);

describe("insertsEmEventLog — o instrumento", () => {
  it("acusa objeto literal sem entity_kind", () => {
    const src = `admin.from("event_log").insert({ organization_id: o, event_type: "a.b", payload: {} });`;
    expect(insertsEmEventLog(src, "x.ts")).toEqual([{ linha: 1, tipo: "sem_entity_kind" }]);
  });

  it("aceita objeto com entity_kind, também numa cadeia com .then", () => {
    const src = `void admin\n  .from("event_log")\n  .insert({ organization_id: o, event_type: "a.b", entity_kind: "x" })\n  .then(() => 1);`;
    expect(insertsEmEventLog(src, "x.ts")).toEqual([{ linha: 1, tipo: "ok" }]);
  });

  it("acusa o elemento faltante num array de objetos", () => {
    const src = `db.from('event_log').insert([{ entity_kind: "x" }, { event_type: "a.b" }]);`;
    expect(insertsEmEventLog(src, "x.ts")).toEqual([{ linha: 1, tipo: "sem_entity_kind" }]);
  });

  it("separa argumento não literal e ignora outras tabelas e a palavra em comentário", () => {
    const src = `// .from("event_log").insert({})\nadmin.from("event_log").insert(linhas);\nadmin.from("messages").insert({ a: 1 });`;
    expect(insertsEmEventLog(src, "x.ts")).toEqual([{ linha: 2, tipo: "nao_literal" }]);
  });
});

describe("event_log — todo insert direto leva entity_kind", () => {
  const arquivos = PASTAS.flatMap((p) => arquivosTs(join(RAIZ, p)));

  const porTipo = (tipo: Achado["tipo"]) =>
    arquivos.flatMap((f) =>
      insertsEmEventLog(readFileSync(f, "utf8"), f)
        .filter((a) => a.tipo === tipo)
        .map((a) => `${relative(RAIZ, f).replace(/\\/g, "/")}:${a.linha}`),
    );

  it("a varredura alcança os inserts que já existem", () => {
    // Sem isto, um caminho errado faria o teste passar varrendo zero arquivos.
    const total = arquivos.reduce(
      (n, f) => n + insertsEmEventLog(readFileSync(f, "utf8"), f).length,
      0,
    );
    expect(total).toBeGreaterThan(3);
  });

  it("nenhum insert literal sem entity_kind (é NOT NULL: falharia em toda chamada)", () => {
    expect(porTipo("sem_entity_kind")).toEqual([]);
  });

  it("insert não literal só os já conhecidos", () => {
    const arquivosNaoLiterais = [...new Set(porTipo("nao_literal").map((s) => s.replace(/:\d+$/, "")))];
    expect(arquivosNaoLiterais.filter((f) => !NAO_LITERAIS_CONHECIDOS.has(f))).toEqual([]);
  });
});
