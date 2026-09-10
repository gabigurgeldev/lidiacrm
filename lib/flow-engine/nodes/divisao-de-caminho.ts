/**
 * Flow Engine — "Dividir os caminhos" (`logic.split`).
 *
 * ## A pergunta que faltava
 *
 * O construtor já sabia escolher caminho por PERGUNTA (`logic.if` — "Decidir")
 * e correr TODOS de uma vez (`logic.fork` — "Fazer ao mesmo tempo"). Faltava
 * dividir o tráfego: mandar esta execução por uma linha e a próxima por outra,
 * sem que nada no lead determine qual. É o que teste A/B, revezamento de texto
 * e divisão de carga entre sub-fluxos pedem.
 *
 * ⚠️ Não confundir com os blocos de `routing.*`. Aqueles distribuem PESSOAS
 * (qual vendedor atende); este distribui ARESTAS (por onde a execução segue).
 * Um bloco de divisão não olha disponibilidade, capacidade nem horário — não há
 * "caminho indisponível", então ele nunca espera e nunca tem saída de exceção.
 *
 * ## Os três modos
 *
 * - `aleatorio` — sorteio. Concentra por natureza: três execuções seguidas pelo
 *   mesmo caminho é resultado normal.
 * - `igualitario` — olha o placar e manda para quem está atrás. É o único que
 *   se corrige sozinho: caminho acrescentado depois entra com zero e absorve as
 *   próximas até empatar.
 * - `fila` — a fila indiana: gira 1,2,3,1,2,3 na ordem desenhada, sem olhar
 *   placar.
 *
 * O estado dos dois últimos mora no banco, por bloco — ver `PortaDeDivisao`.
 */

import { z } from "zod";

import { escolherAleatorio, escolherPorFila, escolherPorPlacar } from "../divisao";
import type { FlowBranch, FlowNodeDefinition, NodeExecutionResult } from "../types";

/** O caminho escolhido fica no escopo: é como um bloco seguinte sabe por onde veio. */
export const VAR_CAMINHO_ESCOLHIDO = "caminho_escolhido";

export const MODOS_DE_DIVISAO = ["aleatorio", "igualitario", "fila"] as const;
export type ModoDeDivisao = (typeof MODOS_DE_DIVISAO)[number];

const caminhoSchema = z.object({
  /** Estável dentro do bloco: é ele que a ligação no quadro guarda. */
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(60),
});

export const divisaoConfigSchema = z
  .strictObject({
    modo: z.enum(MODOS_DE_DIVISAO).default("fila"),
    caminhos: z.array(caminhoSchema).min(2).max(10),
  })
  .refine((c) => new Set(c.caminhos.map((r) => r.id)).size === c.caminhos.length, {
    message: "cada caminho precisa de um id próprio",
    path: ["caminhos"],
  });

export type DivisaoConfig = z.infer<typeof divisaoConfigSchema>;

export const logicSplit: FlowNodeDefinition<DivisaoConfig> = {
  type: "logic.split",
  version: 1,
  category: "logic",
  rotulo: "Dividir os caminhos",
  descricao:
    "Reparte as execuções entre as saídas: por sorteio, equilibrando ou em fila, na ordem.",
  // Sem `mutaCrm`: este bloco não encosta no lead. Marcá-lo custaria uma
  // recarga de fatos por execução para não mudar nada.
  configSchema: divisaoConfigSchema,
  /**
   * Um ramo por caminho e NENHUM `else`, pela mesma razão escrita no `logic.fork`:
   * um pega-tudo aqui seria uma saída que modo nenhum escolhe — ramo morto
   * desenhado no quadro.
   *
   * `kind: "match"` é deliberado: a validação de publicação passa a exigir
   * ligação em cada caminho. Caminho de divisão solto não é "erro que o operador
   * não quer tratar" (que é o caso das saídas de exceção) — é um em cada N leads
   * sumindo, e é justamente o defeito que ninguém percebe olhando o quadro.
   */
  branches: (config): FlowBranch[] =>
    config.caminhos.map((c) => ({ id: c.id, label: c.label, kind: "match" as const })),
  execute: async (ctx, config): Promise<NodeExecutionResult> => {
    const ids = config.caminhos.map((c) => c.id);
    const primeiro = ids[0];
    // `caminhos` tem min(2) no schema, então isto é impossível — mas o motor
    // entrega `config` já validada e o TypeScript não sabe disso.
    if (primeiro === undefined) return { kind: "dead", reason: "divisao_sem_caminhos" };

    const escolhido = await escolher(ctx, config, ids);

    return {
      kind: "advance",
      branch_id: escolhido ?? primeiro,
      vars: { [VAR_CAMINHO_ESCOLHIDO]: escolhido ?? primeiro },
    };
  },
};

/**
 * Nunca devolve `fail`, e isso é decisão: um caminho é sempre alcançável, então
 * a única falha possível é o banco não responder o cursor/placar. Nesse caso o
 * chamador cai no primeiro caminho e a execução SEGUE — é a mesma política da
 * fila indiana em `supabase-adapter.ts`: perder a vez uma vez é melhor que
 * segurar o lead. Parar aqui trocaria uma divisão levemente torta por um fluxo
 * parado.
 */
async function escolher(
  ctx: Parameters<FlowNodeDefinition<DivisaoConfig>["execute"]>[0],
  config: DivisaoConfig,
  ids: readonly string[],
): Promise<string | null> {
  if (config.modo === "aleatorio") return escolherAleatorio(ids);

  if (config.modo === "igualitario") {
    return ctx.divisao.proximoPorPlacar({ nodeId: ctx.nodeId, ramos: ids });
  }

  const cursor = await ctx.divisao.proximoDaFila({ nodeId: ctx.nodeId, tamanho: ids.length });
  return escolherPorFila(ids, cursor);
}
