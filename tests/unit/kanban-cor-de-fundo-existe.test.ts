import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * `bg-surface-muted` não existe no tailwind.config (só `surface` e
 * `surface-elevated`): a classe não gerava CSS e as colunas do Kanban ficavam
 * sem fundo, sem erro nenhum. Esta cerca impede o nome de voltar.
 */
describe("tokens de superfície do Kanban", () => {
  it("nenhum componente do Kanban usa `surface-muted`, que não existe", () => {
    const dir = join(__dirname, "..", "..", "components", "kanban");
    const usam = readdirSync(dir)
      .filter((f) => f.endsWith(".tsx"))
      .filter((f) => readFileSync(join(dir, f), "utf8").includes("surface-muted"));
    expect(usam).toEqual([]);
  });
});
