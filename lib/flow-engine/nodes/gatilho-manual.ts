/**
 * Flow Engine — o gatilho de início MANUAL, disparado pelo botão da conversa.
 *
 * Ao contrário de `trigger.lead_created`, este NÃO declara `eventos`: ele não
 * escuta o barramento. O matcher (`trigger-matcher.ts`) monta o conjunto de
 * tipos que arma a partir de `eventos`, então um gatilho sem `eventos` nunca é
 * armado por evento nenhum — a única forma de começar um fluxo destes é o
 * endpoint de start manual (`POST /api/v1/flows/[id]/start`), que o atendente
 * aciona pelo botão "Ativar fluxo" dentro do atendimento.
 *
 * Existir como nó é o que dá ao operador um ponto de entrada único no grafo e a
 * `validarParaPublicar` o "um gatilho, e só um" que ela já cobra — e é o que faz
 * o kind do gatilho ser DERIVÁVEL do grafo (sem `eventos` ⇒ manual), sem uma
 * segunda lista digitada à mão em paralelo.
 */
import { z } from "zod";

import { ramoPadrao, type FlowNodeDefinition } from "../types";

export const triggerManual: FlowNodeDefinition<Record<string, never>> = {
  type: "trigger.manual",
  version: 1,
  category: "trigger",
  rotulo: "Ativação manual pelo botão",
  descricao:
    "Começa o fluxo quando um atendente aperta “Ativar fluxo” dentro da conversa e escolhe este fluxo para o contato.",
  // SEM `eventos`, de propósito: quem arma é o botão, não o barramento.
  configSchema: z.strictObject({}),
  branches: () => [ramoPadrao("Começa aqui")],
  execute: async () => ({ kind: "advance", branch_id: "else" }),
};
