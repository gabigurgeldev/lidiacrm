/**
 * As telas da Central de IA usam o cabeçalho do kit de Ajustes.
 *
 * Até aqui, cada uma das telas de `app/app/ai/` montava o próprio cabeçalho —
 * `<header><h1 className="text-2xl …">` com espaçamentos e cores de descrição
 * diferentes (`text-muted-foreground` numa, `text-text-muted` noutra, `mb-6`
 * numa terceira). Agora todas passam por `PaginaAjustes`
 * (`components/ajustes/estrutura.tsx`), e este teste reprova o `<h1>` feito à
 * mão que voltar.
 *
 * A allowlist só encolhe: são telas de DETALHE (um contato, um fluxo, uma
 * integração), cujo título é um dado e não o nome da tela — e a lista de
 * agentes, que o PR da lista por número já converteu.
 *
 * Sabotagem medida: devolver o `<h1>` à mão em `cases/page.tsx` ⇒ vermelho.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = path.join(process.cwd(), "app/app/ai");

const AINDA_A_MAO = new Set([
  "app/app/ai/agents/page.tsx",
  "app/app/ai/followups/enrollments/[id]/_components/DossieDoFollowup.tsx",
  "app/app/ai/followups/[id]/_components/PublishBar.tsx",
  "app/app/ai/integracoes/[id]/_components/PainelDaIntegracao.tsx",
]);

function arquivos(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return arquivos(p);
    return e.name.endsWith(".tsx") && !e.name.endsWith(".test.tsx") ? [p] : [];
  });
}

const relativo = (p: string) => path.relative(process.cwd(), p).split(path.sep).join("/");

describe("Central de IA no kit de Ajustes", () => {
  const todos = arquivos(RAIZ);

  it("a varredura enxerga as telas (guarda de vacuidade)", () => {
    const comKit = todos.filter((f) => fs.readFileSync(f, "utf8").includes("<PaginaAjustes"));
    expect(comKit.length).toBeGreaterThanOrEqual(14);
  });

  it("nenhuma tela monta o próprio <h1>", () => {
    const amao = todos.filter((f) => /<h1[\s>]/.test(fs.readFileSync(f, "utf8"))).map(relativo);
    expect(amao.filter((f) => !AINDA_A_MAO.has(f)), "use <PaginaAjustes titulo descricao> de @/components/ajustes").toEqual([]);
  });

  it("a allowlist não guarda entrada morta", () => {
    const vivos = new Set(todos.filter((f) => /<h1[\s>]/.test(fs.readFileSync(f, "utf8"))).map(relativo));
    expect([...AINDA_A_MAO].filter((f) => !vivos.has(f))).toEqual([]);
  });
});
