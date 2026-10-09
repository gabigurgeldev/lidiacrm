/**
 * As telas de agente falam português — catraca contra jargão em inglês.
 *
 * Quem configura um agente não sabe o que é "superseded", "Steps", "Trace",
 * "Diff", "Provider", "Tools" ou "dry-run", e "agent" no meio de uma frase em
 * português parece erro. Todas as ocorrências foram trocadas; este teste
 * reprova a volta.
 *
 * O que ele varre: o texto de `t("…")` e o texto solto entre tags JSX, em
 * `app/app/ai/agents/**`. Comentário e identificador de código não contam.
 *
 * Sabotagem medida: voltar `t("Passos")` para `t("Steps")` em RunsTable ⇒ vermelho.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = path.join(process.cwd(), "app/app/ai/agents");
const PROIBIDO = /\b(agents?|Agents?|superseded|Diff|Steps|Trace|Provider|Tools|dry-run|default|Publish)\b/;

function arquivos(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return arquivos(p);
    return /\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name) ? [p] : [];
  });
}

function textosVisiveis(fonte: string): string[] {
  const semComentario = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  const doT = [...semComentario.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!);
  const doJsx = [...semComentario.matchAll(/>\s*([A-Za-zÀ-ú][^<>{}\n]*?)\s*</g)].map((m) => m[1]!);
  return [...doT, ...doJsx];
}

describe("telas de agente sem jargão em inglês", () => {
  const todos = arquivos(RAIZ);

  it("a varredura enxerga as telas (guarda de vacuidade)", () => {
    expect(todos.length).toBeGreaterThan(15);
    const umTexto = textosVisiveis(fs.readFileSync(path.join(RAIZ, "[id]/_components/RunsTable.tsx"), "utf8"));
    expect(umTexto).toContain("Passos");
  });

  it("nenhum texto visível usa os termos proibidos", () => {
    const achados: string[] = [];
    for (const arq of todos) {
      for (const texto of textosVisiveis(fs.readFileSync(arq, "utf8"))) {
        if (PROIBIDO.test(texto)) achados.push(`${path.relative(process.cwd(), arq)}: "${texto}"`);
      }
    }
    expect(achados, "jargão em inglês na tela do agente — use o termo em português").toEqual([]);
  });
});
