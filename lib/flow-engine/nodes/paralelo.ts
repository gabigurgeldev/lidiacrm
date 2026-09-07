/**
 * Flow Engine — os blocos do PARALELO: bifurcar, reencontrar, repetir, esperar
 * um evento e chamar outro fluxo.
 *
 * Puros como os demais: nenhum toca porta nenhuma do contexto. Quem faz o I/O
 * do paralelo é o motor — abrir frentes, contar chegadas, cancelar irmãs — e é
 * de propósito que a decisão do reencontro NÃO mora aqui: o bloco de merge não
 * sabe quantas irmãs existem nem quem já chegou, e dar a ele acesso ao banco
 * para descobrir o faria deixar de ser puro como todo o resto do registry.
 */

import { z } from "zod";

import { VAR_DO_EVENTO } from "../acordar-por-evento";
import { resolverCampo } from "../condicoes";
import { ramoPadrao, type FlowBranch, type FlowNodeDefinition, type NodeExecutionResult } from "../types";

// ─────────────────────────────── logic.fork ──────────────────────────────────

const ramoDoForkSchema = z.strictObject({
  /** Estável. Renomear o rótulo nunca solta a aresta. */
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(60),
});

/**
 * ⚠️ `encontro` é declarado, não descoberto.
 *
 * A tentação é o motor inferir o merge por alcançabilidade — achar o primeiro
 * nó que todos os ramos alcançam. Isso acerta no grafo simples e erra em
 * qualquer grafo com dois forks aninhados, e erra em SILÊNCIO: o fluxo segue,
 * reencontrando no lugar errado. Declarar custa um campo no formulário e torna
 * o erro impossível.
 */
export const forkConfigSchema = z
  .strictObject({
    ramos: z.array(ramoDoForkSchema).min(2).max(6),
    modo: z.enum(["todas", "primeira"]),
    encontro: z.string().min(1).max(64),
  })
  .refine((c) => new Set(c.ramos.map((r) => r.id)).size === c.ramos.length, {
    message: "cada caminho precisa de um id próprio",
    path: ["ramos"],
  });

export type ForkConfig = z.infer<typeof forkConfigSchema>;

export const logicFork: FlowNodeDefinition<ForkConfig> = {
  type: "logic.fork",
  version: 1,
  category: "logic",
  rotulo: "Fazer ao mesmo tempo",
  descricao:
    "Segue por vários caminhos de uma vez e volta a juntar no bloco de reencontro.",
  configSchema: forkConfigSchema,
  // Um ramo por caminho, e NENHUM `else`: um fork que também tivesse saída
  // padrão teria um caminho que não conta no reencontro, e o merge em modo
  // "todas" esperaria por uma frente que nunca foi aberta.
  branches: (config): FlowBranch[] =>
    config.ramos.map((r) => ({ id: r.id, label: r.label, kind: "match" as const })),
  execute: async (_ctx, config): Promise<NodeExecutionResult> => ({
    kind: "fork",
    branch_ids: config.ramos.map((r) => r.id),
    modo: config.modo,
    join_node_id: config.encontro,
  }),
};

// ────────────────────────────── logic.merge ──────────────────────────────────

/**
 * O ponto de reencontro. Não decide nada — quando o motor deixa a execução
 * chegar aqui, a decisão já foi tomada.
 *
 * Existir como bloco é o que dá ao operador um lugar para ligar os caminhos de
 * volta, e ao `encontro` do fork um alvo com id estável. Um merge implícito
 * (o fork apontando direto para o nó seguinte) economizaria um bloco e tiraria
 * do canvas a única marca visível de que aqueles caminhos se juntam.
 */
export const logicMerge: FlowNodeDefinition<Record<string, never>> = {
  type: "logic.merge",
  version: 1,
  category: "logic",
  rotulo: "Reencontro",
  descricao: "Onde os caminhos que correm ao mesmo tempo voltam a ser um só.",
  configSchema: z.strictObject({}),
  branches: () => [ramoPadrao("Segue")],
  execute: async (): Promise<NodeExecutionResult> => ({ kind: "advance", branch_id: "else" }),
};

// ─────────────────────────────── logic.loop ──────────────────────────────────

/**
 * O teto é OBRIGATÓRIO, e é a razão de o laço poder existir.
 *
 * A validação de publicação proíbe qualquer ciclo no grafo justamente porque um
 * ciclo sem fim queima `steps_taken` até a execução morrer de "passos_demais".
 * Com um teto declarado, o ciclo passa a ter fim conhecido ANTES de começar — e
 * uma lista de mil itens que veio de uma resposta de API não vira mil chamadas
 * pagas de IA.
 */
const TETO_MAXIMO = 100;

export const loopConfigSchema = z.strictObject({
  /** Caminho no escopo (`{{...}}` sem as chaves) para a lista a percorrer. */
  lista: z.string().min(1).max(120),
  max: z.number().int().min(1).max(TETO_MAXIMO),
});

export type LoopConfig = z.infer<typeof loopConfigSchema>;

export const RAMO_DO_CORPO = "corpo";
export const RAMO_DO_FIM = "else";

export const logicLoop: FlowNodeDefinition<LoopConfig> = {
  type: "logic.loop",
  version: 1,
  category: "logic",
  rotulo: "Repetir para cada",
  descricao: "Percorre uma lista item a item e segue adiante quando ela acaba.",
  configSchema: loopConfigSchema,
  branches: (): FlowBranch[] => [
    { id: RAMO_DO_CORPO, label: "Para cada item", kind: "match" },
    ramoPadrao("Quando acabar"),
  ],
  execute: async (ctx, config): Promise<NodeExecutionResult> => {
    const { valor: cru } = resolverCampo(ctx.escopo, config.lista);
    // Campo que não é lista percorre ZERO vezes, em vez de percorrer os
    // caracteres de um texto ou as chaves de um objeto. Uma lista que veio
    // vazia e uma que veio errada terminam do mesmo jeito — pelo ramo do fim —,
    // e isso é melhor que um laço que roda 27 vezes sobre um nome próprio.
    const itens = Array.isArray(cru) ? cru : [];
    return {
      kind: "loop",
      items: itens,
      body_branch_id: RAMO_DO_CORPO,
      done_branch_id: RAMO_DO_FIM,
      max: config.max,
    };
  },
};

// ──────────────────────────── logic.await_event ──────────────────────────────

/** Cinco minutos: menos que isso o relógio do worker (1×/min) não distingue. */
const PRAZO_MINIMO_MS = 5 * 60_000;
/** 30 dias. Uma espera maior que isso é um fluxo que ninguém vai reconhecer. */
const PRAZO_MAXIMO_MS = 30 * 24 * 60 * 60_000;

/**
 * Os eventos que o bloco de espera oferece — FONTE ÚNICA.
 *
 * O formulário lê daqui e o handler do barramento também. Fossem duas listas,
 * elas divergiriam no primeiro evento novo, e do pior jeito possível: a pessoa
 * escolheria a opção na tela, o fluxo dormiria, o evento aconteceria — e
 * ninguém acordaria, porque o handler nunca soube desse evento.
 */
export const EVENTOS_QUE_ACORDAM = [
  "message.received",
  "lead.stage_changed",
  "lead.won",
  "lead.lost",
] as const;

export const awaitEventConfigSchema = z.strictObject({
  evento: z.enum(EVENTOS_QUE_ACORDAM),
  /**
   * Filtro de igualdade rasa sobre o payload — "a resposta DAQUELA conversa",
   * não "qualquer resposta". Sem ele, a mensagem de um cliente acordaria a
   * espera de outro, que é o pior tipo de vazamento entre conversas: não é de
   * dado, é de comportamento.
   */
  quando: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  prazo_ms: z.number().int().min(PRAZO_MINIMO_MS).max(PRAZO_MAXIMO_MS),
});

export type AwaitEventConfig = z.infer<typeof awaitEventConfigSchema>;

export const RAMO_CHEGOU = "chegou";
export const RAMO_NO_PRAZO = "else";

export const logicAwaitEvent: FlowNodeDefinition<AwaitEventConfig> = {
  type: "logic.await_event",
  version: 1,
  category: "logic",
  rotulo: "Esperar acontecer",
  descricao: "Fica parado até um evento chegar, ou até o prazo vencer.",
  configSchema: awaitEventConfigSchema,
  branches: (): FlowBranch[] => [
    { id: RAMO_CHEGOU, label: "Aconteceu", kind: "match" },
    ramoPadrao("Venceu o prazo"),
  ],
  execute: async (ctx, config): Promise<NodeExecutionResult> => {
    // ⚠️ QUEM SABE POR QUE ESTA VOLTA ACONTECEU É O NÓ, não o motor — a mesma
    // divisão que `logic.wait` já usa. O motor sabe que o relógio venceu; ele
    // não sabe se, para ESTE bloco, isso significa "acabou" ou "falta mais uma
    // espera". Aqui a pergunta é outra: voltei porque o evento chegou, ou
    // porque o prazo venceu?
    if (ctx.esperaEmCurso !== null) {
      // O acordador escreve o payload no espaço da frente ao acordá-la. Ele
      // estar lá é a única diferença observável entre as duas voltas.
      const chegou = ctx.escopo.frame.vars[VAR_DO_EVENTO] !== undefined;
      return { kind: "advance", branch_id: chegou ? RAMO_CHEGOU : RAMO_NO_PRAZO };
    }
    return {
      kind: "await_event",
      event_type: config.evento,
      match: config.quando,
      // O prazo é obrigatório no tipo do resultado, e é o que impede a espera
      // por evento de virar uma execução que nada no sistema jamais coleta —
      // um fluxo parado para sempre, sem uma linha de erro em lugar nenhum.
      timeout_at: new Date(ctx.agora().getTime() + config.prazo_ms),
      branch_on_timeout: RAMO_NO_PRAZO,
    };
  },
};

// ────────────────────────────── flow.call ────────────────────────────────────

export const callConfigSchema = z.strictObject({
  fluxo_id: z.string().uuid(),
  /**
   * O que a filha recebe como `{{event.*}}`. Os valores passam pelo
   * interpolador, então `{{lead.title}}` aqui vira o título do lead de quem
   * chamou — é assim que um sub-fluxo genérico serve a vários chamadores.
   */
  entrada: z.record(z.string(), z.string().max(500)).default({}),
});

export type CallConfig = z.infer<typeof callConfigSchema>;

export const flowCall: FlowNodeDefinition<CallConfig> = {
  type: "flow.call",
  version: 1,
  category: "logic",
  rotulo: "Chamar outro fluxo",
  descricao: "Roda outro fluxo como uma sub-rotina e espera ele terminar.",
  configSchema: callConfigSchema,
  branches: () => [ramoPadrao("Quando terminar")],
  execute: async (ctx, config): Promise<NodeExecutionResult> => {
    const entrada: Record<string, unknown> = {};
    for (const [chave, valor] of Object.entries(config.entrada)) {
      entrada[chave] = ctx.render(valor);
    }
    return { kind: "call_subflow", flow_id: config.fluxo_id, input: entrada, branch_id: "else" };
  },
};
