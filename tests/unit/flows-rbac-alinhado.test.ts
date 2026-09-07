import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * TODA ROTA DE `/api/v1/flows` EXIGE O MESMO PAPEL — `manager`.
 *
 * ─── O defeito, medido ──────────────────────────────────────────────────────
 *
 * O `DELETE` de `app/api/v1/flows/[id]/route.ts` era a ÚNICA rota do módulo a
 * exigir `admin`; GET, PATCH, publish e state exigem `manager`, e a própria
 * página (`app/app/flows/page.tsx`) redireciona quem está abaixo de `manager`.
 * O efeito não era "mais seguro": era um botão de excluir visível para quem a
 * rota recusa — 403 depois do clique, sem nada na tela explicando por quê.
 *
 * O argumento de fundo é que a régua estava invertida. Quem PUBLICA um fluxo põe
 * uma automação para falar com cliente e mexer no funil sozinha; apagar o
 * rascunho dela é menos grave que isso. O que protege a exclusão não é o papel —
 * é a recusa de 409 quando há execução viva, e a RLS (`tenant_isolation_flows_all`,
 * `for all` com `fn_role_at_least(…,'manager')`).
 *
 * ─── Por que um guarda de CLASSE, e não um teste da rota ────────────────────
 *
 * Consertar a instância deixa a próxima rota do módulo nascer torta, e o modo de
 * falha é mudo: um `admin` a mais não quebra nada em teste, só some com um botão
 * na tela de quem deveria vê-lo. Este guarda varre o AST de TODA rota sob
 * `app/api/v1/flows/`, então alcança rota que ainda não existe.
 *
 * Se um dia uma rota deste módulo PRECISAR de `admin`, o certo é escrever aqui a
 * exceção com o motivo — não afrouxar a varredura.
 */

const RAIZ = join(__dirname, "..", "..");
const DIR_FLOWS = join(RAIZ, "app", "api", "v1", "flows");

/** Guarda positivo: se a varredura achar menos que isto, o parser morreu. */
const MINIMO_DE_CHAMADAS = 8;

function rotas(dir: string): string[] {
  const achados: string[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const caminho = join(dir, entrada.name);
    if (entrada.isDirectory()) achados.push(...rotas(caminho));
    else if (entrada.name === "route.ts") achados.push(caminho);
  }
  return achados;
}

/** O primeiro argumento de cada `requireRole("<papel>", …)` do arquivo. */
function papeisExigidos(codigo: string): string[] {
  const fonte = ts.createSourceFile("route.ts", codigo, ts.ScriptTarget.Latest, true);
  const papeis: string[] = [];

  const visitar = (no: ts.Node): void => {
    if (
      ts.isCallExpression(no) &&
      ts.isIdentifier(no.expression) &&
      no.expression.text === "requireRole"
    ) {
      const primeiro = no.arguments[0];
      // Papel que não é literal de string não é auditável por leitura estática:
      // reprovar é o certo, não ignorar em silêncio.
      papeis.push(primeiro !== undefined && ts.isStringLiteral(primeiro) ? primeiro.text : "?");
    }
    ts.forEachChild(no, visitar);
  };

  visitar(fonte);
  return papeis;
}

describe("RBAC do módulo de fluxos", () => {
  const arquivos = rotas(DIR_FLOWS);

  it("acha rotas de fluxo para varrer", () => {
    expect(arquivos.length).toBeGreaterThan(0);
  });

  it("toda rota de /api/v1/flows exige exatamente `manager`", () => {
    const fora: string[] = [];
    let total = 0;

    for (const arquivo of arquivos) {
      const relativo = arquivo.slice(RAIZ.length + 1).replace(/\\/g, "/");
      for (const papel of papeisExigidos(readFileSync(arquivo, "utf8"))) {
        total += 1;
        if (papel !== "manager") fora.push(`${relativo} → requireRole(${papel})`);
      }
    }

    expect(total).toBeGreaterThanOrEqual(MINIMO_DE_CHAMADAS);
    expect(fora).toEqual([]);
  });
});
