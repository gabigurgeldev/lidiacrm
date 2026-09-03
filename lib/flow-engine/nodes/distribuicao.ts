/**
 * Flow Engine — as outras duas formas de escolher quem atende, e a entrega à IA.
 *
 * ## Três blocos, três perguntas diferentes
 *
 * O rodízio (`routing.round_robin`, em `crm-e-roteamento.ts`) responde "de quem
 * é a vez, por justiça": quem está há mais tempo sem receber. É o certo na
 * maioria das equipes, e é por isso que ele veio primeiro.
 *
 * Os daqui respondem outras perguntas:
 *
 * - `routing.random` — "que ninguém saiba de quem é a vez". Distribui por
 *   ACASO, e o acaso concentra: três leads seguidos para a mesma pessoa é
 *   resultado normal, não defeito. Quem quer divisão pareja usa o rodízio.
 * - `routing.fixed_order` — "a ordem é esta, e é ela que vale". Uma sequência
 *   declarada por quem monta o fluxo, percorrida em volta. Times costumam ter
 *   uma ordem combinada que o sistema não conhece (o sênior atende primeiro,
 *   quem entrou ontem atende por último), e o rodízio a ignora por construção.
 * - `crm.handoff_to_agent` — "ninguém humano: o agente atende". O inverso da
 *   passagem para humano.
 */

import { z } from "zod";

import { selectRandom } from "@/lib/routing/decide";

import { ramoPadrao, type FlowNodeDefinition, type NodeExecutionResult } from "../types";
import { VAR_DONO_ESCOLHIDO } from "./crm-e-roteamento";

const RAMO_SEM_NINGUEM = "sem_ninguem";

/** Os mesmos ajustes do rodízio: o que fazer quando não há ninguém agora. */
const quandoNinguemSchema = {
  quando_ninguem: z.enum(["tentar_depois", "seguir_pelo_senao"]).default("tentar_depois"),
  tentar_de_novo_em_ms: z
    .number()
    .int()
    .min(60_000)
    .max(24 * 60 * 60_000)
    .default(5 * 60_000),
};

// ─────────────────────────── routing.random ──────────────────────────────────

export const sorteioConfigSchema = z.strictObject({ ...quandoNinguemSchema });
export type SorteioConfig = z.infer<typeof sorteioConfigSchema>;

export const routingRandom: FlowNodeDefinition<SorteioConfig> = {
  type: "routing.random",
  version: 1,
  category: "routing",
  rotulo: "Sortear um vendedor",
  mutaCrm: true,
  descricao: "Escolhe por sorteio entre quem está disponível agora.",
  configSchema: sorteioConfigSchema,
  branches: (): ReturnType<FlowNodeDefinition["branches"]> => [
    { id: RAMO_SEM_NINGUEM, label: "Ninguém disponível", kind: "match" },
    ramoPadrao("Depois de sortear"),
  ],
  execute: async (ctx, config): Promise<NodeExecutionResult> => {
    const lead = ctx.fatos.lead;
    if (lead === null) return { kind: "dead", reason: "sem_lead_para_distribuir" };

    const elegiveis = await ctx.roteamento.elegiveis({ organizationId: ctx.organizationId });
    const escolhido = selectRandom([...elegiveis]);

    if (escolhido === null) return semNinguem(ctx, config);

    await ctx.crm.atribuirDono({ leadId: lead.id, userId: escolhido });
    return { kind: "advance", branch_id: "else", vars: { [VAR_DONO_ESCOLHIDO]: escolhido } };
  },
};

// ───────────────────────── routing.fixed_order ───────────────────────────────

export const filaFixaConfigSchema = z.strictObject({
  /**
   * A ordem, como a pessoa a escreveu. É ela que vale — inclusive quando parece
   * injusta, porque a ordem combinada do time é informação que o sistema não tem.
   */
  ordem: z.array(z.string().uuid()).min(1).max(50).default([]),
  ...quandoNinguemSchema,
});
export type FilaFixaConfig = z.infer<typeof filaFixaConfigSchema>;

export const routingFixedOrder: FlowNodeDefinition<FilaFixaConfig> = {
  type: "routing.fixed_order",
  version: 1,
  category: "routing",
  rotulo: "Distribuir em fila, na ordem",
  mutaCrm: true,
  descricao: "Percorre a ordem de vendedores que você definir, um lead por vez.",
  configSchema: filaFixaConfigSchema,
  branches: (): ReturnType<FlowNodeDefinition["branches"]> => [
    { id: RAMO_SEM_NINGUEM, label: "Ninguém disponível", kind: "match" },
    ramoPadrao("Depois de distribuir"),
  ],
  execute: async (ctx, config): Promise<NodeExecutionResult> => {
    const lead = ctx.fatos.lead;
    if (lead === null) return { kind: "dead", reason: "sem_lead_para_distribuir" };
    if (config.ordem.length === 0) return { kind: "dead", reason: "fila_sem_ninguem_na_ordem" };

    const elegiveis = await ctx.roteamento.elegiveis({ organizationId: ctx.organizationId });
    // A vez vem do banco, não do escopo da execução: cada lead abre uma execução
    // nova, e um cursor por execução reiniciaria a fila a cada lead — entregando
    // sempre ao primeiro da ordem. Ver a migration 0211.
    const { userId, avancou } = await ctx.roteamento.proximoDaFilaFixa({
      nodeId: ctx.nodeId,
      ordem: config.ordem,
      elegiveis: elegiveis.map((e) => e.userId),
    });

    if (userId === null) return semNinguem(ctx, config);

    await ctx.crm.atribuirDono({ leadId: lead.id, userId });
    return {
      kind: "advance",
      branch_id: "else",
      vars: { [VAR_DONO_ESCOLHIDO]: userId, fila_posicao: avancou },
    };
  },
};

/** O caminho de "não há ninguém agora", igual ao do rodízio. */
function semNinguem(
  ctx: Parameters<FlowNodeDefinition<SorteioConfig>["execute"]>[0],
  config: { quando_ninguem: string; tentar_de_novo_em_ms: number },
): NodeExecutionResult {
  // Ninguém disponível NÃO é falha: é fora de horário, todo mundo no teto, ou
  // ninguém marcado como disponível. Insistir com backoff de erro mataria o
  // fluxo às 22h de uma sexta.
  if (config.quando_ninguem === "seguir_pelo_senao") {
    return { kind: "advance", branch_id: RAMO_SEM_NINGUEM };
  }
  return {
    kind: "wait",
    next_eval_at: new Date(ctx.agora().getTime() + config.tentar_de_novo_em_ms),
    motivo: "ninguem_elegivel",
  };
}

// ─────────────────────── crm.handoff_to_agent ────────────────────────────────

export const entregarAoAgenteConfigSchema = z.strictObject({});
export type EntregarAoAgenteConfig = z.infer<typeof entregarAoAgenteConfigSchema>;

/**
 * ⚠️ ESTE BLOCO SOLTA UMA TRAVA QUE O AGENTE NÃO PODE SOLTAR SOZINHO.
 *
 * A passagem para humano tem TRÊS travas (`lib/escalacao/retomada.ts`):
 * `contacts.force_human`, `conversations.assignee_kind` e `bot_silenced_until`.
 * A primeira é descrita lá como "irrevogável pelo agente" — a tool que a expõe
 * ao modelo é marcada como capacidade de risco crítico e não vem ligada.
 *
 * Este bloco a solta. A diferença que o justifica: quem decide aqui é a PESSOA
 * que montou o fluxo e arrastou este bloco, não o modelo decidindo sobre si
 * mesmo em tempo de conversa. É a mesma natureza do botão "devolver ao agente"
 * na tela, e passa pela mesma função — não por um `update` paralelo.
 *
 * Ainda assim é o bloco mais consequente desta leva: posto depois de uma
 * escalada para humano, ele desfaz a escalada. O rótulo e a descrição dizem
 * isso; a decisão de tê-lo é de quem monta o fluxo.
 */
export const crmHandoffToAgent: FlowNodeDefinition<EntregarAoAgenteConfig> = {
  type: "crm.handoff_to_agent",
  version: 1,
  category: "crm",
  rotulo: "Entregar a conversa para a IA",
  mutaCrm: true,
  descricao: "Devolve o atendimento ao agente de IA, desfazendo a passagem para humano.",
  configSchema: entregarAoAgenteConfigSchema,
  branches: (): ReturnType<FlowNodeDefinition["branches"]> => [
    { id: "sem_conversa", label: "Sem conversa aberta", kind: "match" },
    ramoPadrao("Depois de entregar"),
  ],
  execute: async (ctx): Promise<NodeExecutionResult> => {
    const contato = ctx.fatos.contact;
    if (contato === null) return { kind: "advance", branch_id: "sem_conversa" };

    const r = await ctx.crm.devolverAoAgente({ contactId: contato.id });
    if (!r.ok) return { kind: "advance", branch_id: "sem_conversa", vars: { ia_erro: r.motivo } };

    return {
      kind: "advance",
      branch_id: "else",
      // `jaEstavaComOAgente` distingue "eu devolvi" de "já estava lá". A
      // operação é idempotente, e sem esta marca o fluxo não teria como contar
      // quantas vezes REALMENTE tirou uma conversa de um humano.
      vars: { ia_ja_atendia: r.jaEstavaComOAgente },
    };
  },
};
