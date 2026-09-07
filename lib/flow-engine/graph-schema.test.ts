import { describe, expect, it } from "vitest";

import { flowGraphSchema } from "./graph-schema";

/**
 * O QUADRO VAZIO É INVÁLIDO — E A TELA CONTA COM ISSO.
 *
 * `nodes` é `.min(1)`. Quem salva um quadro sem bloco nenhum recebe 400 com
 * "Dados inválidos." — frase sobre o CORPO DO PEDIDO, para um problema que é
 * sobre o QUADRO. Por isso o construtor (`app/app/flows/[id]/_components/FlowCanvas.tsx`)
 * guarda ANTES de pedir: se `nos.length === 0`, avisa em português de operação e
 * não emite o PATCH.
 *
 * Este teste existe para que afrouxar o `.min(1)` não passe em silêncio. Se um
 * dia o schema aceitar grafo vazio, o guarda da tela vira mentira (recusa o que
 * o servidor aceitaria), e `analisarGrafo`, `validarParaPublicar`,
 * `paraReactFlow` e o construtor com IA ganham todos um caso vazio que hoje
 * nenhum trata. Mudar isto é decisão, não detalhe — e aqui é onde a decisão
 * aparece.
 */
describe("flowGraphSchema", () => {
  it("recusa grafo sem nenhum bloco", () => {
    expect(flowGraphSchema.safeParse({ nodes: [], edges: [] }).success).toBe(false);
  });

  it("aceita grafo com um bloco só e nenhuma ligação", () => {
    const r = flowGraphSchema.safeParse({
      nodes: [
        {
          id: "n1",
          type: "trigger.lead_created",
          label: "Lead novo",
          position: { x: 0, y: 0 },
          config: {},
        },
      ],
      edges: [],
    });
    expect(r.success).toBe(true);
  });
});
