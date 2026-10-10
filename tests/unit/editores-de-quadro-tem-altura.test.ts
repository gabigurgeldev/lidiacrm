/**
 * Editor de quadro (React Flow) trava a própria altura.
 *
 * O React Flow mede 100% da altura do pai. No `AppShell`, toda tela logada fica
 * dentro de um invólucro `max-w` SEM altura definida — então `h-full` na cadeia
 * do editor resolve para `auto`, o canvas fica com 0px e o quadro some com a
 * paleta à mostra. Foi o que aconteceu com o editor de follow-up (medido no e2e
 * em 2026-10-09: `.react-flow` "hidden" em `followup-ramos` e
 * `followup-linguagem`), enquanto o editor de fluxos, que já travava a altura,
 * funcionava.
 *
 * Sabotagem medida: voltar o editor de follow-up para `h-full` deixa este teste
 * vermelho.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const EDITORES = [
  "app/app/flows/[id]/_components/FlowBuilder.tsx",
  "app/app/ai/followups/[id]/_components/FlowBuilder.tsx",
];

describe("editores de quadro têm altura própria", () => {
  it.each(EDITORES)("%s trava a altura em vez de herdar h-full do AppShell", (arquivo) => {
    const fonte = fs.readFileSync(path.join(process.cwd(), arquivo), "utf8");
    const casca = /export function FlowBuilder[\s\S]*?className="([^"]+)"/.exec(fonte)?.[1] ?? "";
    expect(casca, "não achei a classe da casca do editor").not.toBe("");
    expect(casca).toMatch(/\bh-\[calc\(100dvh-\d+px\)\]/);
    expect(casca.split(/\s+/)).not.toContain("h-full");
  });
});
