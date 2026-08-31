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
/**
 * `whatsapp.notify_user`: sem a união do `destinatario`.
 *
 * Dois motivos, e o segundo importa mais que a compatibilidade. O primeiro é a
 * forma: `destinatario` é `discriminatedUnion`, que emite `oneOf` — recusado por
 * saída estruturada.
 *
 * O segundo: a variante `{ tipo: "usuario" }` é RECUSADA PELO PRÓPRIO MOTOR.
 * `lib/flow-engine/nodes/avisos.ts` devolve
 * `{ kind: "dead", reason: "destinatario_fixo_ainda_nao_suportado" }` ao
 * executá-la. Ou seja, era uma forma que a IA podia gerar e que morreria em
 * execução — o fluxo nasceria bonito na tela e falharia calado no primeiro lead.
 * Oferecer à IA só o que o motor sabe rodar é o comportamento correto,
 * independente de provedor.
 */
const notifyUserConfigParaGeracao = z.strictObject({
  destinatario: z
    .strictObject({ tipo: z.literal("dono_do_lead") })
    .default({ tipo: "dono_do_lead" })
    .describe("Sempre o dono do lead — é o único destinatário que o motor executa hoje."),
  mensagem: z.string().min(1).max(4000),
});

const CONFIG_PARA_GERACAO: Readonly<Record<string, z.ZodTypeAny>> = {
  "logic.if": ifConfigParaGeracao,
  "whatsapp.notify_user": notifyUserConfigParaGeracao,
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
