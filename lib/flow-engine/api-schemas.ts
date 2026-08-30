/**
 * Flow Engine — os contratos de request da API.
 *
 * Só a FORMA do corpo. A validação semântica do grafo (tipos conhecidos,
 * ciclos, ramo sem saída) vive em `validate-publish.ts` e roda na publicação,
 * não no salvamento — senão um rascunho meio montado não poderia ser salvo.
 */

import { z } from "zod";

import { flowGraphSchema } from "./graph-schema";

export const criarFluxoSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  folder: z.string().trim().max(60).optional(),
});

/**
 * O gatilho no formato que o ponteiro guarda. Hoje só há um tipo, e ele é
 * derivado do nó de início do grafo — mas o campo existe desde já porque a
 * VERSÃO o congela na publicação, e mudar isso depois obrigaria a migrar
 * versões publicadas.
 */
export const gatilhoSchema = z.strictObject({
  kind: z.literal("event"),
});

export const editarFluxoSchema = z.strictObject({
  name: z.string().trim().min(1).max(80).optional(),
  folder: z.string().trim().max(60).nullable().optional(),
  draft_graph: flowGraphSchema.optional(),
  settings: z
    .strictObject({
      /**
       * Deixa este fluxo reagir a eventos que o próprio motor causou. Padrão
       * `false`: o anti-loop de profundidade 1 é o comportamento seguro, e
       * ligá-lo é decisão consciente de quem monta.
       */
      reagir_ao_proprio_motor: z.boolean().optional(),
    })
    .optional(),
});

export const trocarEstadoSchema = z.strictObject({
  status: z.enum(["active", "paused"]),
});
