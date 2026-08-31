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

import { OPERADORES } from "../condicoes";
import { flowEdgeSchema } from "../graph-schema";
import { garantirNosRegistrados } from "../register-all";
import { todosOsNos } from "../registry";
import type { FlowNodeDefinition } from "../types";

/**
 * CONFIG SIMPLIFICADO PARA GERAÇÃO — subconjunto do runtime, nunca outra forma.
 *
 * O `configSchema` de runtime de `logic.if` embute `grupoSchema`, que é
 * `z.lazy` recursivo (`lib/flow-engine/condicoes.ts`). Convertido para JSON
 * Schema, isso vira `$defs` com uma auto-referência `$ref` — e provedores de
 * saída estruturada não lidam com isso: o Gemini não suporta `$ref`/`$defs`, e
 * a chamada falha inteira. Junto vinha `valor: z.unknown()`, que emite um
 * schema VAZIO (`{}`, sem `type`), recusado em modo estrito.
 *
 * Medido: o JSON Schema completo tem 8.645 bytes, com `oneOf` de 11 variantes,
 * `$ref` recursivo e `{}` — contra ~250 bytes do worker de sentimento, que
 * sempre funcionou.
 *
 * A regra que torna isto seguro: o que a IA pode gerar é um SUBCONJUNTO ESTRITO
 * do que o runtime aceita. Uma condição de um nível só (`itens` apenas com
 * regras, sem grupos aninhados) é um valor perfeitamente válido para
 * `grupoSchema` — quem gerar assim passa na validação de runtime sem tradução
 * nenhuma. O que se perde é a IA propor condições aninhadas de várias camadas,
 * que ela quase nunca propõe e que a pessoa monta na tela em seguida.
 */
const regraParaGeracao = z.strictObject({
  campo: z.string().min(1).max(120).describe("Caminho por ponto, ex.: 'lead.score', 'vars.tentativas'."),
  op: z.enum(OPERADORES),
  // Tipado de propósito: `z.unknown()` do runtime vira `{}` no JSON Schema, que
  // é justamente o que o modo estrito recusa. Estes três cobrem o que a IA
  // propõe na prática, e todos são valores válidos para o runtime.
  valor: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

const ifConfigParaGeracao = z.strictObject({
  saidas: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(64),
        label: z.string().min(1).max(60),
        quando: z.strictObject({
          combinador: z.enum(["and", "or"]),
          negar: z.boolean().optional(),
          // Sem recursão: só regras. Ver o cabeçalho acima.
          itens: z.array(regraParaGeracao).min(1).max(20),
        }),
      }),
    )
    .min(1)
    .max(8),
});

/**
 * Override por tipo de nó. Vazio para todos os outros — só entra aqui o nó cujo
 * schema de runtime é hostil à saída estruturada, e com a justificativa acima.
 */
const CONFIG_PARA_GERACAO: Readonly<Record<string, z.ZodTypeAny>> = {
  "logic.if": ifConfigParaGeracao,
};

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
