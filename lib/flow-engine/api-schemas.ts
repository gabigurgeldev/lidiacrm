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
 * O gatilho no formato que o ponteiro guarda. O kind é DERIVADO do nó de início
 * do grafo (`lib/flow-engine/gatilho.ts`): "event" quando o gatilho escuta o
 * barramento, "manual" quando só o botão da conversa o dispara. A VERSÃO o
 * congela na publicação, e por isso o campo existe desde a 0203.
 */
export const gatilhoSchema = z.strictObject({
  kind: z.enum(["event", "manual"]),
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
