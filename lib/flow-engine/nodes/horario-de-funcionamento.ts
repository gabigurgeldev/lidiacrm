/**
 * Flow Engine — o bloco que pergunta se ESTAMOS ABERTOS AGORA.
 *
 * ## O buraco que este arquivo fecha
 *
 * O motor tinha `logic.wait` ("espere 30 minutos") e nada mais sobre tempo. Um
 * fluxo respondia 3h de domingo exatamente como responderia 10h de terça — e a
 * única saída para quem não queria isso era o bloco "Esperar", que é DURAÇÃO
 * FIXA: ele não sabe quanto falta até a segunda-feira, e um "espere 10 horas"
 * escrito à mão acerta uma vez e erra em todas as outras.
 *
 * Aqui o operador declara o expediente e o bloco faz a conta.
 *
 * ## Por que a conta mora em `lib/horario/`, e não neste arquivo
 *
 * Porque ela já existia. `lib/agent-engine/agent/janela-de-atendimento.ts` faz
 * exatamente esta pergunta para o agente de IA desde 2026-08-18. Copiar as
 * linhas para cá seria a duplicação sem fonte declarada que a doutrina proíbe, e
 * com um custo concreto: a conta tem borda por dia da semana e por meia-noite, e
 * duas cópias divergem na primeira correção — o agente atendendo numa hora e o
 * fluxo em outra, sem nada na tela dizendo isso. O relógio saiu para
 * `lib/horario/janela-semanal.ts`, que os dois importam; um nó não pode importar
 * `lib/agent-engine` (`registry.test.ts` mantém todo nó puro).
 *
 * ## As duas respostas para "está fechado", e por que as duas existem
 *
 * `desviar` e `esperar` não são preferência de estilo — são fluxos diferentes:
 *
 *   * **Desviar** serve para quem tem o que dizer de madrugada ("atendemos das
 *     8h às 18h, já já alguém te responde"). A execução segue AGORA, por outro
 *     caminho.
 *   * **Esperar** serve para o que não pode sair fora de hora: cobrança, oferta,
 *     lembrete. A execução dorme e retoma na abertura.
 *
 * Um bloco com só a primeira obrigaria a gambiarra do "Esperar" de duração fixa.
 * Um bloco com só a segunda não teria como responder nada de madrugada — e
 * silêncio é o modo de falha que este repo já pagou caro.
 *
 * ## Falha ABERTA
 *
 * Config que não dá para obedecer (fuso que o runtime não conhece, horário
 * torto) faz o bloco seguir por "Dentro do horário", e não travar o fluxo. Mesma
 * direção do arquivo de origem: uma janela quebrada pode atrasar a resposta,
 * nunca sumir com ela. A tela barra essas configs antes de publicar
 * (`superRefine`); isto aqui é a rede embaixo.
 */

import { z } from "zod";

import { lerJanelaSemanal, msAteAJanelaAbrir, minutosDe } from "@/lib/horario/janela-semanal";
import { fusoValido } from "@/lib/tempo/fusos";

import {
  ramoDeExcecao,
  ramoPadrao,
  type FlowNodeDefinition,
  type NodeExecutionResult,
} from "../types";

const RAMO_FORA = "fora";
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * ⚠️ SCHEMA PLANO — nada de `z.discriminatedUnion` em ponto nenhum da árvore.
 *
 * `lib/flow-engine/ai/schema-sem-uniao-na-raiz.test.ts` reprova união
 * discriminada dentro de um `configSchema`: ela vira `oneOf` no JSON Schema e o
 * provedor de saída estruturada recusa — o "Criar fluxo com IA" quebra inteiro
 * para quem usa modelo roteado.
 */
export const horarioDeFuncionamentoConfigSchema = z
  .strictObject({
    /**
     * VALIDADO contra o `Intl`, e não só por tamanho: é o `Intl` que a conta
     * usa, e ele LANÇA num fuso que não existe. `America/Asunción` — com o
     * acento que um hispanofalante escreve natural — salvaria sem reclamar e
     * derrubaria a avaliação em toda execução. Mesma defesa de
     * `availabilityScheduleSchema`.
     */
    fuso: z.string().min(1).max(64).refine(fusoValido, "Fuso horário inválido.").default("America/Sao_Paulo"),
    inicio: z.string().regex(HHMM, "Use HH:MM, como 08:00.").default("08:00"),
    fim: z.string().regex(HHMM, "Use HH:MM, como 18:00.").default("18:00"),
    /** 0=domingo … 6=sábado. Segunda a sexta por padrão, que é o caso comum. */
    dias: z.array(z.number().int().min(0).max(6)).max(7).default([1, 2, 3, 4, 5]),
    fora_do_horario: z.enum(["desviar", "esperar"]).default("desviar"),
  })
  .superRefine((config, ctx) => {
    if (config.dias.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["dias"],
        message: "Escolha ao menos um dia da semana.",
      });
    }
    const inicio = minutosDe(config.inicio);
    const fim = minutosDe(config.fim);
    // Janela que vira a meia-noite (22:00–02:00) é recusada, e recusar é melhor
    // que interpretar ao contrário: `fim <= inicio` viraria "fechado sempre", a
    // mordaça que este bloco não pode criar. Barrado aqui = barrado na tela.
    if (inicio !== null && fim !== null && fim <= inicio) {
      ctx.addIssue({
        code: "custom",
        path: ["fim"],
        message: "O fim precisa ser depois do começo. Expediente que atravessa a meia-noite ainda não é suportado.",
      });
    }
  });

export type HorarioDeFuncionamentoConfig = z.infer<typeof horarioDeFuncionamentoConfigSchema>;

export const logicHorarioDeFuncionamento: FlowNodeDefinition<HorarioDeFuncionamentoConfig> = {
  type: "logic.business_hours",
  version: 1,
  category: "logic",
  rotulo: "Horário de funcionamento",
  descricao: "Separa o que acontece dentro e fora do expediente — e pode segurar o fluxo até abrir.",
  configSchema: horarioDeFuncionamentoConfigSchema,
  branches: (): ReturnType<FlowNodeDefinition["branches"]> => [
    // Exceção, e não `match`: quem escolhe "segurar até abrir" nunca liga esta
    // saída, e um `match` solto trava a publicação do fluxo inteiro.
    ramoDeExcecao(RAMO_FORA, "Fora do horário"),
    ramoPadrao("Dentro do horário"),
  ],
  execute: async (ctx, config): Promise<NodeExecutionResult> => {
    const janela = lerJanelaSemanal({
      timezone: config.fuso,
      start: config.inicio,
      end: config.fim,
      weekdays: config.dias,
    });
    // Sem janela obedecível: segue aberto. Ver "Falha ABERTA" no cabeçalho.
    if (janela === null) return { kind: "advance", branch_id: "else" };

    const abreEmMs = msAteAJanelaAbrir(janela, ctx.agora());

    // A PERGUNTA VEM PRIMEIRO, antes de olhar a espera em curso. Este bloco não
    // conta um cronômetro: ele lê o relógio de parede. Consultar `esperaEmCurso`
    // antes faria uma execução acordada por outro motivo, já dentro do
    // expediente, voltar a dormir até a hora que foi calculada quando estava
    // fechado.
    if (abreEmMs === null) return { kind: "advance", branch_id: "else" };

    if (config.fora_do_horario === "desviar") {
      return {
        kind: "advance",
        branch_id: RAMO_FORA,
        // Vai para o escopo para o bloco seguinte poder dizer "voltamos em X".
        vars: { abre_em_ms: abreEmMs },
      };
    }

    if (ctx.esperaEmCurso !== null && ctx.agora() < ctx.esperaEmCurso.ate) {
      // Acordou cedo e ainda está fechado: volta a dormir até a MESMA hora, sem
      // recalcular. Recalcular daria o mesmo instante (a conta é de relógio de
      // parede, não de contagem regressiva), mas devolver o valor já gravado é o
      // que a doutrina do motor manda — e é o que continua certo no dia em que
      // alguém trocar esta conta por outra.
      return { kind: "wait", next_eval_at: ctx.esperaEmCurso.ate, motivo: "fora_do_horario" };
    }

    return {
      kind: "wait",
      next_eval_at: new Date(ctx.agora().getTime() + abreEmMs),
      motivo: "fora_do_horario",
    };
  },
};
