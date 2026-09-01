/**
 * Flow Engine — o `config` de UM tipo de bloco, na forma que um provedor aceita.
 *
 * ═══ Por que este arquivo existe separado ═══
 *
 * Estas três formas (`regraParaGeracao`, `ifConfigParaGeracao`,
 * `notifyUserConfigParaGeracao`) nasceram dentro de `generation-schema.ts`,
 * onde serviam a UM consumidor: o schema gigante de uma chamada só. A geração
 * passou a ser por etapas — plano primeiro, config de cada bloco depois — e
 * duas partes do sistema precisam da MESMA resposta para "qual é o schema de
 * config do tipo X que um provedor aceita?". Duplicar essa resposta seria
 * criar duas fontes de verdade para a regra mais frágil do produto.
 *
 * ═══ A regra que torna o subconjunto seguro ═══
 *
 * O que a IA pode gerar é SUBCONJUNTO ESTRITO do que o runtime aceita. Uma
 * condição de um nível só é um valor perfeitamente válido para o `grupoSchema`
 * recursivo do runtime — quem gerar assim passa na validação sem tradução
 * nenhuma. O que se perde é a IA propor condições aninhadas de várias camadas,
 * que a pessoa monta na tela em seguida.
 *
 * Vigiado por `config-schema-cabe-no-provedor.test.ts` (forma) e
 * `config-gerado-cabe-no-runtime.test.ts` (o exemplo de cada tipo passa nos
 * dois schemas).
 */
import { z } from "zod";

import { OPERADORES } from "../condicoes";
import { garantirNosRegistrados } from "../register-all";
import { buscarNo, tiposRegistrados } from "../registry";

/**
 * CONDIÇÃO DE UM NÍVEL SÓ — sem `$ref`, sem `{}`.
 *
 * O `configSchema` de runtime de `logic.if` embute `grupoSchema`, que é
 * `z.lazy` recursivo (`lib/flow-engine/condicoes.ts`). Convertido para JSON
 * Schema isso vira `$defs` com auto-referência `$ref`, e provedores de saída
 * estruturada não lidam com isso — o Gemini não suporta `$ref` e a chamada
 * falha inteira. Junto vinha `valor: z.unknown()`, que emite schema VAZIO
 * (`{}`, sem `type`), recusado em modo estrito.
 */
const regraParaGeracao = z.strictObject({
  campo: z
    .string()
    .min(1)
    .max(120)
    .describe("Caminho por ponto, ex.: 'lead.score', 'vars.tentativas'."),
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
 * `whatsapp.notify_user`: sem a união do `destinatario`.
 *
 * Dois motivos, e o segundo importa mais que a compatibilidade. O primeiro é a
 * forma: `destinatario` é `discriminatedUnion`, que emite `oneOf` — recusado
 * por saída estruturada.
 *
 * O segundo: a variante `{ tipo: "usuario" }` é RECUSADA PELO PRÓPRIO MOTOR.
 * `lib/flow-engine/nodes/avisos.ts` devolve
 * `{ kind: "dead", reason: "destinatario_fixo_ainda_nao_suportado" }` ao
 * executá-la. Era uma forma que a IA podia gerar e que morreria em execução —
 * o fluxo nasceria bonito na tela e falharia calado no primeiro lead. Oferecer
 * à IA só o que o motor sabe rodar é o comportamento correto, independente de
 * provedor.
 */
const notifyUserConfigParaGeracao = z.strictObject({
  destinatario: z
    .strictObject({ tipo: z.literal("dono_do_lead") })
    .default({ tipo: "dono_do_lead" })
    .describe("Sempre o dono do lead — é o único destinatário que o motor executa hoje."),
  mensagem: z.string().min(1).max(4000),
});

/**
 * Override por tipo. Vazio para todos os outros — só entra aqui o nó cujo
 * schema de runtime é hostil à saída estruturada, e com a justificativa acima.
 */
export const CONFIG_PARA_GERACAO: Readonly<Record<string, z.ZodTypeAny>> = {
  "logic.if": ifConfigParaGeracao,
  "whatsapp.notify_user": notifyUserConfigParaGeracao,
};

/**
 * Um schema de objeto SEM propriedade nenhuma (`{"type":"object","properties":{}}`).
 *
 * `trigger.lead_created` tem `configSchema: z.strictObject({})`, e pedir a um
 * provedor que preencha um objeto sem campos é, na melhor hipótese, uma chamada
 * paga para receber `{}` de volta — e, em parte deles, uma recusa. Tipo assim
 * não chama modelo: vai direto para `configExemploDoTipo`.
 */
function semCampos(schema: z.ZodTypeAny): boolean {
  try {
    const json = z.toJSONSchema(schema, { io: "input" }) as {
      type?: unknown;
      properties?: Record<string, unknown>;
    };
    return json.type === "object" && Object.keys(json.properties ?? {}).length === 0;
  } catch {
    // Schema que nem converte para JSON Schema não pode ir a provedor nenhum —
    // tratar como "sem campos" o manda para o caminho do exemplo, que é o
    // comportamento seguro. Quem vigia a conversão é a cerca de forma.
    return true;
  }
}

/**
 * O schema que a IA recebe para UM tipo — ou `null` quando não há o que pedir.
 *
 * `null` significa "não chame o modelo para este bloco": ou o tipo não existe,
 * ou o config dele não tem campo nenhum.
 */
export function schemaDeConfigParaGeracao(tipo: string): z.ZodTypeAny | null {
  garantirNosRegistrados();
  const override = CONFIG_PARA_GERACAO[tipo];
  if (override) return override;
  const def = buscarNo(tipo);
  if (!def) return null;
  const schema = def.configSchema as z.ZodTypeAny;
  return semCampos(schema) ? null : schema;
}

/** Os tipos que nunca chamam modelo. Derivado, nunca digitado à mão. */
export function tiposSemConfig(): string[] {
  garantirNosRegistrados();
  return tiposRegistrados().filter((tipo) => schemaDeConfigParaGeracao(tipo) === null);
}
