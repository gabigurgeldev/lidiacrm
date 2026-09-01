/**
 * Flow Engine — o schema que a IA usa para gerar um grafo.
 *
 * ═══ Por que não é `flowGraphSchema` (`../graph-schema.ts`) ═══
 *
 * Aquele schema tem `config: z.unknown()` DE PROPÓSITO — é o passe 2
 * (`analisarGrafo`) que valida `config` contra o `configSchema` do tipo
 * específico, depois que o tipo já foi resolvido. Isso é certo para o editor
 * manual (a pessoa escolhe o tipo, depois preenche o formulário daquele
 * tipo), mas seria péssimo para geração por IA: um modelo que vê `config:
 * unknown` no JSON Schema não tem NENHUMA pista sobre o formato — ele
 * inventaria chaves, e a geração falharia silenciosamente na revalidação.
 *
 * ═══ A saída: um discriminated union montado a partir do REGISTRY ═══
 *
 * Uma variante por tipo de nó HOJE registrado, cada uma com o `configSchema`
 * exato daquele tipo embutido. Construído em runtime a partir de
 * `todosOsNos()` — nunca uma cópia à mão das 11 formas. Um 12º tipo
 * registrado amanhã entra automaticamente na próxima chamada, sem editar
 * este arquivo. É a mesma filosofia de "registro, não `switch`" que já rege
 * `lib/flow-engine/registry.ts`.
 *
 * ═══ `position` NÃO é pedida à IA ═══
 *
 * Layout espacial é a única coisa que um modelo de texto faz mal de graça.
 * A posição vem de `auto-layout.ts` (BFS puro a partir do trigger), aplicada
 * DEPOIS que o grafo é gerado — nunca pedida ao modelo.
 *
 * ═══ Roda no cliente E no servidor ═══
 *
 * `garantirNosRegistrados()`/`todosOsNos()` são TypeScript puro, sem DOM e
 * sem I/O — já rodam no browser hoje (`FlowCanvas.tsx` os importa direto,
 * fora de qualquer Server Component). É o que permite ao `useObject` do
 * cliente usar o MESMO schema que a rota de streaming no servidor, sem
 * duplicar a forma.
 */
import { z } from "zod";

import { flowEdgeSchema } from "../graph-schema";
import { garantirNosRegistrados } from "../register-all";
import { todosOsNos } from "../registry";
import type { FlowNodeDefinition } from "../types";
import { CONFIG_PARA_GERACAO } from "./config-para-geracao";

/**
 * As formas simplificadas por tipo vivem em `config-para-geracao.ts`.
 *
 * Elas saíram daqui quando a geração passou a ter uma etapa que pede o config
 * de UM bloco por vez: as duas etapas precisam da mesma resposta para "qual é o
 * schema de config que um provedor aceita?", e duas cópias dessa resposta
 * seriam duas fontes de verdade para a regra mais frágil do produto.
 */

/** Uma variante do union — um tipo de nó, com o `configSchema` dele embutido. */
function variantePara(def: FlowNodeDefinition<never>) {
  return z.object({
    id: z
      .string()
      .min(1)
      .max(64)
      .describe("Identificador curto e estável, ex.: 'n1', 'checa_score'. Único no grafo."),
    type: z.literal(def.type),
    label: z
      .string()
      .min(1)
      .max(80)
      .describe(`Rótulo em português que aparece no bloco. Ex.: "${def.rotulo}".`),
    config: CONFIG_PARA_GERACAO[def.type] ?? def.configSchema,
  });
}

/**
 * Monta o schema. Chamar de novo depois que um nó novo for registrado
 * reflete o registry atual — não há cache aqui de propósito, o custo de
 * remontar é desprezível (11 objetos Zod) e o registry raramente muda depois
 * do boot do processo.
 */
export function montarSchemaDeGeracao() {
  garantirNosRegistrados();
  const nos = todosOsNos();

  /**
   * `z.union` e NÃO `z.discriminatedUnion` — a diferença é o que faz a chamada
   * funcionar. Medido:
   *
   *   z.discriminatedUnion(...)  ->  { $schema, oneOf }
   *   z.union(...)               ->  { $schema, anyOf }
   *
   * Structured Outputs de APIs compatíveis com OpenAI aceita `anyOf` e recusa
   * `oneOf`. Com o `oneOf`, a OpenRouter respondia erro e o stream morria —
   * medido com DOIS modelos de fabricantes diferentes (gemini-2.5-flash-lite e
   * qwen3.8-flash), o que descartou o modelo e acusou o formato.
   *
   * `strictJsonSchema: false` na rota NÃO resolve isto: ele afrouxa `required` e
   * `additionalProperties`, e não troca a palavra-chave da união.
   *
   * O que se perde: a mensagem de erro do Zod deixa de apontar a variante certa
   * pelo campo `type` e passa a listar as tentativas. Custo de depuração local,
   * pago uma vez; o `oneOf` custava a funcionalidade inteira, sempre.
   *
   * Vigiado por `generation-schema-cabe-no-provedor.test.ts`.
   */
  const variantes = nos.map(variantePara);
  const noSchema =
    variantes.length >= 2
      ? z.union(variantes as [typeof variantes[0], typeof variantes[0], ...(typeof variantes[0])[]])
      : variantes[0]!;

  return z.object({
    nodes: z
      .array(noSchema)
      .min(1)
      .max(60)
      .describe("Os blocos do fluxo. O primeiro nó de categoria trigger é onde o fluxo começa."),
    edges: z
      .array(flowEdgeSchema)
      .max(120)
      .describe(
        "As ligações entre blocos. branch_id é o id da saída do bloco de origem — 'else' é a saída padrão de todo bloco.",
      ),
  });
}

export type SchemaDeGeracao = ReturnType<typeof montarSchemaDeGeracao>;
