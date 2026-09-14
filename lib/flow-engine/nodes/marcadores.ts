/**
 * Flow Engine — PÔR e TIRAR marcador do cliente.
 *
 * ## O defeito que este arquivo fecha
 *
 * `crm.add_tag` vivia em `crm-e-roteamento.ts` e só sabia escrever no LEAD:
 * sem lead, devolvia `{ kind: "dead", reason: "sem_lead_para_marcar" }`. Só que
 * um fluxo armado por mensagem de WhatsApp **nunca tem lead** — o matcher só
 * preenche `lead_id` quando o evento é de lead (`trigger-matcher.ts`), e para
 * `message.received` vem só o contato. Ou seja: no caminho mais usado do
 * produto o bloco não marcava ninguém, não seguia para o bloco seguinte, e
 * ainda matava a execução sem uma linha de erro em lugar nenhum.
 *
 * A regra de alvo é a MESMA da automação antiga
 * (`lib/automation/actions/add-tag.ts`): lead quando há lead, contato quando
 * não há. Duas réguas para "onde mora o marcador" fariam a marcação sair num
 * lugar e a condição procurar no outro — que é a forma em que o defeito
 * reaparece.
 *
 * ## Por que exceção e não `dead`
 *
 * Quando não há nem lead nem contato (ou o marcador renderiza vazio), o bloco
 * sai pela saída de exceção e grava o motivo em `vars`. `dead` encerra a
 * execução inteira e não escreve nada que a tela mostre; a saída de exceção
 * pode ficar solta (o motor encerra a frente com `sem_saida:<ramo>`) e o motivo
 * aparece na trilha. Falha visível, não falha calada.
 */

import { z } from "zod";

import {
  ramoDeExcecao,
  ramoPadrao,
  type AlvoDeMarcador,
  type FatosDaExecucao,
  type FlowNodeDefinition,
  type NodeExecutionResult,
} from "../types";

/** A saída de quando o marcador não foi aplicado. Exceção: pode ficar solta. */
export const RAMO_NAO_MARCOU = "nao_marcou";

/** A chave de `vars` que a trilha lê. Só código nosso — nunca texto do cliente. */
export const VAR_MARCACAO_RECUSADA = "marcacao_recusada";

export const marcadorConfigSchema = z.strictObject({
  tag: z.string().trim().min(1).max(40),
});
export type MarcadorConfig = z.infer<typeof marcadorConfigSchema>;

/** Lead quando há lead; contato quando não há. `null` quando não há nenhum. */
export function alvoDoMarcador(fatos: FatosDaExecucao): AlvoDeMarcador | null {
  if (fatos.lead !== null) return { kind: "lead", id: fatos.lead.id };
  if (fatos.contact !== null) return { kind: "contato", id: fatos.contact.id };
  return null;
}

type Ctx = Parameters<FlowNodeDefinition<MarcadorConfig>["execute"]>[0];

function recusar(motivo: string): NodeExecutionResult {
  return {
    kind: "advance",
    branch_id: RAMO_NAO_MARCOU,
    vars: { [VAR_MARCACAO_RECUSADA]: motivo },
  };
}

async function aplicar(
  ctx: Ctx,
  config: MarcadorConfig,
  acao: "marcar" | "desmarcar",
): Promise<NodeExecutionResult> {
  const alvo = alvoDoMarcador(ctx.fatos);
  if (alvo === null) return recusar("sem_alvo");

  const tag = ctx.render(config.tag).trim();
  if (tag === "") return recusar("marcador_vazio");

  if (acao === "marcar") await ctx.crm.marcar({ alvo, tag });
  else await ctx.crm.desmarcar({ alvo, tag });

  return { kind: "advance", branch_id: "else" };
}

export const crmAddTag: FlowNodeDefinition<MarcadorConfig> = {
  type: "crm.add_tag",
  version: 1,
  category: "crm",
  rotulo: "Marcar o cliente",
  mutaCrm: true,
  descricao: "Põe um marcador no cliente, para achar, filtrar e decidir depois.",
  configSchema: marcadorConfigSchema,
  branches: () => [
    ramoDeExcecao(RAMO_NAO_MARCOU, "Não deu para marcar"),
    ramoPadrao("Depois de marcar"),
  ],
  execute: (ctx, config) => aplicar(ctx, config, "marcar"),
};

export const crmRemoveTag: FlowNodeDefinition<MarcadorConfig> = {
  type: "crm.remove_tag",
  version: 1,
  category: "crm",
  rotulo: "Desmarcar o cliente",
  mutaCrm: true,
  descricao: "Tira um marcador do cliente, para ele sair das listas que o usam.",
  configSchema: marcadorConfigSchema,
  branches: () => [
    ramoDeExcecao(RAMO_NAO_MARCOU, "Não deu para desmarcar"),
    ramoPadrao("Depois de desmarcar"),
  ],
  execute: (ctx, config) => aplicar(ctx, config, "desmarcar"),
};
