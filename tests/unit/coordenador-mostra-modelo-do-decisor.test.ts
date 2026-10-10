/**
 * A escolha do modelo do decisor fica NA tela do coordenador.
 *
 * Ela morava só em IA › Provedores, dentro de "Configuração avançada", e quem
 * configurava o coordenador não achava (2026-10-10). O cartão é o mesmo da tela
 * de provedores — este teste só garante que ele continua aparecendo aqui, para
 * o ponto certo.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { PONTOS_DE_IA } from "@/lib/ai/pontos/registro";
import { FINALIDADE_DO_DECISOR } from "@/lib/coordenador/decisor/llm";

describe("tela do coordenador", () => {
  const fonte = readFileSync(join(process.cwd(), "app/app/ai/coordenador/_client.tsx"), "utf-8");

  it("mostra o cartão de modelo do ponto que o decisor usa", () => {
    expect(fonte).toContain(`<ModeloDoPonto pontoId="${FINALIDADE_DO_DECISOR}" />`);
  });

  it("o ponto existe no registro (senão o cartão some calado)", () => {
    expect(PONTOS_DE_IA.some((p) => p.id === FINALIDADE_DO_DECISOR)).toBe(true);
  });
});
