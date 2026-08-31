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
    config: def.configSchema,
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

  // discriminatedUnion exige 2+ variantes — hoje são 11; se o registry algum
  // dia tiver só 1 tipo (não acontece em produção), cai para z.array de um
  // objeto só, sem discriminação, para não lançar em runtime.
  const variantes = nos.map(variantePara);
  const noSchema =
    variantes.length >= 2
      ? z.discriminatedUnion("type", variantes as [typeof variantes[0], typeof variantes[0], ...(typeof variantes[0])[]])
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
