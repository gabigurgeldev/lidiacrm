/**
 * Flow Engine — os nós de lógica: início, decisão, espera e fim.
 *
 * Puros: nenhum deles toca porta nenhuma do contexto. É o que torna o teste
 * deles aritmética, não infraestrutura.
 */

import { z } from "zod";

import { avaliarGrupo, grupoSchema, type Grupo } from "../condicoes";
import { ramoPadrao, type FlowBranch, type FlowNodeDefinition, type NodeExecutionResult } from "../types";

// ───────────────────────────── trigger.lead_created ──────────────────────────

/**
 * O bloco de início por "lead criado". Não decide nada: quem decidiu foi o
 * matcher, ao ver o evento e criar a execução. Existir como nó é o que dá ao
 * operador um lugar para ler de onde o fluxo vem, e ao grafo um ponto de
 * entrada único.
 */
export const triggerLeadCreated: FlowNodeDefinition<Record<string, never>> = {
  type: "trigger.lead_created",
  version: 1,
  category: "trigger",
  rotulo: "Quando um lead é criado",
  descricao: "Começa o fluxo toda vez que um lead novo entra no funil.",
  // `lead.created` já é emitido pelo trigger Postgres `fn_emit_event_on_lead_change`.
  // Nada de novo a emitir: o barramento existe, faltava quem escutasse.
  eventos: ["lead.created"],
  configSchema: z.strictObject({}),
  branches: () => [ramoPadrao("Começa aqui")],
  execute: async () => ({ kind: "advance", branch_id: "else" }),
};

// ──────────────────────────────── logic.if ───────────────────────────────────

const saidaSchema = z.strictObject({
  /** Estável. Renomear o rótulo nunca solta a aresta. */
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(60),
  quando: grupoSchema,
});

/**
 * IF e SWITCH no mesmo bloco, de propósito. São a mesma pergunta com número de
 * respostas diferente, e dois blocos separados obrigariam o operador a escolher
 * a forma antes de saber quantos casos vai ter — e a refazer as ligações quando
 * o segundo caso aparecesse.
 *
 * A primeira saída cuja condição for verdadeira vence. Ordem importa, e a tela
 * mostra a ordem.
 */
export const ifConfigSchema = z.strictObject({
  saidas: z.array(saidaSchema).min(1).max(8),
}).refine((c) => new Set(c.saidas.map((s) => s.id)).size === c.saidas.length, {
  message: "cada saída precisa de um id próprio",
  path: ["saidas"],
});

export type IfConfig = z.infer<typeof ifConfigSchema>;

export const logicIf: FlowNodeDefinition<IfConfig> = {
  type: "logic.if",
  version: 1,
  category: "logic",
  rotulo: "Decidir",
  descricao: "Segue por um caminho diferente conforme o que for verdade sobre o lead.",
  configSchema: ifConfigSchema,
  branches: (config): FlowBranch[] => [
    ...config.saidas.map((s) => ({ id: s.id, label: s.label, kind: "match" as const })),
    ramoPadrao("Nenhuma delas"),
  ],
  execute: async (ctx, config): Promise<NodeExecutionResult> => {
    for (const saida of config.saidas) {
      if (avaliarGrupo(saida.quando as Grupo, ctx.escopo)) {
        return { kind: "advance", branch_id: saida.id };
      }
    }
    return { kind: "advance", branch_id: "else" };
  },
};

// ─────────────────────────────── logic.wait ──────────────────────────────────

/**
 * Dez segundos.
 *
 * Era CINCO MINUTOS, e a razão estava escrita aqui: "menos que isso o relógio
 * do worker (1×/min) não distingue". Era verdade — com um tick por minuto, uma
 * espera de 10s seria uma mentira na tela, arredondada para até 60s pelo
 * relógio.
 *
 * `lib/flow-engine/loop.ts` tirou esse relógio do caminho: o motor passou a
 * rodar em laço de ~2s dentro do worker, e a retomada saiu de até 60s para
 * ~2s. O piso baixa junto porque a razão dele caiu — não porque alguém quis um
 * número menor.
 *
 * E para em 10s, não em 1s, pelo MESMO argumento: abaixo da cadência do laço o
 * número volta a ser ficção. Se um dia o laço ficar mais rápido, este piso pode
 * acompanhar; enquanto ele for ~2s, 10s é o menor valor que o produto consegue
 * cumprir com folga e sem prometer precisão que não tem.
 */
const ESPERA_MINIMA_MS = 10_000;
/** 90 dias — o mesmo teto do `wait` do follow-up. */
const ESPERA_MAXIMA_MS = 90 * 24 * 60 * 60_000;

export const waitConfigSchema = z.strictObject({
  duracao_ms: z.number().int().min(ESPERA_MINIMA_MS).max(ESPERA_MAXIMA_MS),
});
export type WaitConfig = z.infer<typeof waitConfigSchema>;

export const logicWait: FlowNodeDefinition<WaitConfig> = {
  type: "logic.wait",
  version: 1,
  category: "logic",
  rotulo: "Esperar",
  descricao: "Segura o fluxo por um tempo antes de continuar.",
  configSchema: waitConfigSchema,
  branches: () => [ramoPadrao("Depois da espera")],
  execute: async (ctx, config): Promise<NodeExecutionResult> => {
    // Quem sabe se a espera acabou é o NÓ, não o motor. O motor só reporta o
    // fato (`esperaEmCurso`), porque um nó futuro pode querer esperar duas
    // vezes ou desistir no meio, e essa decisão não cabe no laço genérico.
    if (ctx.esperaEmCurso === null) {
      return {
        kind: "wait",
        next_eval_at: new Date(ctx.agora().getTime() + config.duracao_ms),
        motivo: "espera_configurada",
      };
    }
    if (ctx.agora() < ctx.esperaEmCurso.ate) {
      // Acordou cedo (reclamado por outro motivo). Volta a dormir até a hora
      // combinada, sem reiniciar a contagem — reiniciar faria uma espera de 5
      // min virar eterna se algo acordasse a execução a cada 4.
      return { kind: "wait", next_eval_at: ctx.esperaEmCurso.ate, motivo: "ainda_nao_deu_a_hora" };
    }
    return { kind: "advance", branch_id: "else" };
  },
};

// ─────────────────────────────── logic.end ───────────────────────────────────

export const endConfigSchema = z.strictObject({
  desfecho: z.string().min(1).max(40).default("concluido"),
  nota: z.string().max(200).optional(),
});
export type EndConfig = z.infer<typeof endConfigSchema>;

export const logicEnd: FlowNodeDefinition<EndConfig> = {
  type: "logic.end",
  version: 1,
  category: "logic",
  rotulo: "Fim",
  descricao: "Encerra o fluxo com um desfecho que aparece no relatório.",
  configSchema: endConfigSchema,
  branches: () => [],
  execute: async (_ctx, config): Promise<NodeExecutionResult> => ({
    kind: "complete",
    outcome: config.desfecho,
  }),
};
