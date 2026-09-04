/**
 * Flow Engine — nós de CRM e de distribuição.
 *
 * A lógica de quem recebe o próximo lead NÃO nasce aqui: `escolherPorRodizio`
 * abaixo é uma casca fina sobre a mesma régua de `lib/routing/decide.ts`, que
 * já é pura e já é testada. Duas implementações de rodízio no mesmo produto
 * divergiriam na primeira mudança de regra, e a divergência apareceria como
 * "o sistema distribuiu errado", sem ninguém saber qual das duas falou.
 */

import { z } from "zod";

import { selectRoundRobin } from "@/lib/routing/decide";

import { ramoDeExcecao, ramoPadrao, type AtendenteElegivel, type FlowNodeDefinition, type NodeExecutionResult } from "../types";

// ───────────────────────────── crm.add_tag ───────────────────────────────────

export const addTagConfigSchema = z.strictObject({
  tag: z.string().trim().min(1).max(40),
});
export type AddTagConfig = z.infer<typeof addTagConfigSchema>;

export const crmAddTag: FlowNodeDefinition<AddTagConfig> = {
  type: "crm.add_tag",
  version: 1,
  category: "crm",
  rotulo: "Marcar o lead",
  mutaCrm: true,
  descricao: "Põe um marcador no lead, para achar e filtrar depois.",
  configSchema: addTagConfigSchema,
  branches: () => [ramoPadrao("Depois de marcar")],
  execute: async (ctx, config): Promise<NodeExecutionResult> => {
    const lead = ctx.fatos.lead;
    if (lead === null) {
      // `dead` e não `fail`: repetir não vai fazer o lead aparecer. Um fluxo
      // armado por evento de lead cuja execução chegou aqui sem lead está
      // apontando para uma linha apagada, e insistir só gasta tentativa.
      return { kind: "dead", reason: "sem_lead_para_marcar" };
    }
    const tag = ctx.render(config.tag).trim();
    if (tag === "") return { kind: "dead", reason: "marcador_vazio" };
    await ctx.crm.adicionarTag({ leadId: lead.id, tag });
    return { kind: "advance", branch_id: "else" };
  },
};

// ─────────────────────────── routing.round_robin ─────────────────────────────

/**
 * Rodízio: quem esperou mais tempo desde a última atribuição vai primeiro;
 * `null` (nunca recebeu) vai na frente. Desempate determinístico por id, para
 * dois workers no mesmo instante escolherem o mesmo.
 *
 * NÃO é reimplementado aqui: é `selectRoundRobin` de `lib/routing/decide.ts`,
 * que já é puro e já é a régua do roteamento de conversas. Uma segunda
 * implementação divergiria na primeira mudança de regra, e a divergência
 * apareceria como "o sistema distribuiu errado" sem ninguém saber qual das
 * duas falou.
 */
export function escolherPorRodizio(
  candidatos: readonly AtendenteElegivel[],
): string | null {
  return selectRoundRobin([...candidatos]);
}

/** Variável em que o dono escolhido fica, para os nós seguintes o lerem. */
export const VAR_DONO_ESCOLHIDO = "dono_escolhido";
/** Quem já foi tentado e não deu conta — a redistribuição exclui esta lista. */
export const VAR_JA_TENTADOS = "ja_tentados";

const rodizioConfigSchema = z.strictObject({
  /** Se ninguém está elegível: tentar de novo daqui a pouco, ou desviar. */
  quando_ninguem: z.enum(["tentar_depois", "seguir_pelo_senao"]).default("tentar_depois"),
  tentar_de_novo_em_ms: z.number().int().min(60_000).max(24 * 60 * 60_000).default(5 * 60_000),
});
export type RodizioConfig = z.infer<typeof rodizioConfigSchema>;

const RAMO_SEM_NINGUEM = "sem_ninguem";

async function distribuir(
  ctx: Parameters<FlowNodeDefinition<RodizioConfig>["execute"]>[0],
  config: RodizioConfig,
  excluir: readonly string[],
): Promise<NodeExecutionResult> {
  const lead = ctx.fatos.lead;
  if (lead === null) return { kind: "dead", reason: "sem_lead_para_distribuir" };

  const todos = await ctx.roteamento.elegiveis({ organizationId: ctx.organizationId });
  const candidatos = todos.filter((c) => !excluir.includes(c.userId));
  const escolhido = escolherPorRodizio(candidatos);

  if (escolhido === null) {
    // Ninguém disponível NÃO é falha: é fora de horário, todo mundo no teto, ou
    // ninguém marcado como disponível. Insistir com backoff de erro gastaria as
    // 5 tentativas em 15 minutos e mataria o fluxo às 22h de uma sexta.
    if (config.quando_ninguem === "seguir_pelo_senao") {
      return { kind: "advance", branch_id: RAMO_SEM_NINGUEM };
    }
    return {
      kind: "wait",
      next_eval_at: new Date(ctx.agora().getTime() + config.tentar_de_novo_em_ms),
      motivo: "ninguem_elegivel",
    };
  }

  await ctx.crm.atribuirDono({ leadId: lead.id, userId: escolhido });
  const tentados = [...excluir, escolhido];
  return {
    kind: "advance",
    branch_id: "else",
    vars: { [VAR_DONO_ESCOLHIDO]: escolhido, [VAR_JA_TENTADOS]: tentados },
  };
}

export const routingRoundRobin: FlowNodeDefinition<RodizioConfig> = {
  type: "routing.round_robin",
  version: 1,
  category: "routing",
  rotulo: "Distribuir para um vendedor",
  mutaCrm: true,
  descricao: "Entrega o lead ao próximo da fila entre quem está disponível agora.",
  configSchema: rodizioConfigSchema,
  branches: (): ReturnType<FlowNodeDefinition["branches"]> => [
    ramoDeExcecao(RAMO_SEM_NINGUEM, "Ninguém disponível"),
    ramoPadrao("Depois de distribuir"),
  ],
  execute: async (ctx, config) => {
    // A espera de "ninguém disponível" acontece NESTE nó, então voltar a ele com
    // `esperaEmCurso` preenchido é normal e significa "tenta de novo agora".
    const jaTentados = lerLista(ctx.escopo.vars[VAR_JA_TENTADOS]);
    return distribuir(ctx, config, jaTentados);
  },
};

export const routingRedistribute: FlowNodeDefinition<RodizioConfig> = {
  type: "routing.redistribute",
  version: 1,
  category: "routing",
  rotulo: "Passar para outro vendedor",
  mutaCrm: true,
  descricao: "Tira o lead de quem não atendeu e entrega ao próximo da fila.",
  configSchema: rodizioConfigSchema,
  branches: (): ReturnType<FlowNodeDefinition["branches"]> => [
    ramoDeExcecao(RAMO_SEM_NINGUEM, "Ninguém disponível"),
    ramoPadrao("Depois de passar adiante"),
  ],
  execute: async (ctx, config) => {
    // Excluir quem já foi tentado é o que distingue redistribuir de distribuir.
    // Sem isso o rodízio devolveria a MESMA pessoa (ela acabou de ser atribuída,
    // mas o critério é `lastAssignedAt`, e ela pode seguir sendo a mais antiga
    // se ninguém mais existir), e o fluxo giraria em falso avisando sempre o
    // mesmo vendedor que já não respondeu.
    const jaTentados = lerLista(ctx.escopo.vars[VAR_JA_TENTADOS]);
    return distribuir(ctx, config, jaTentados);
  },
};

function lerLista(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

// ────────────────────────── crm.owner_responded? ─────────────────────────────

const respondeuConfigSchema = z.strictObject({
  /**
   * De quando conta. `desde_a_atribuicao` usa o instante em que o dono atual
   * assumiu; `desde_o_inicio_do_fluxo` usa o começo da execução.
   */
  contar_a_partir_de: z
    .enum(["desde_a_atribuicao", "desde_o_inicio_do_fluxo"])
    .default("desde_o_inicio_do_fluxo"),
});
export type RespondeuConfig = z.infer<typeof respondeuConfigSchema>;

const RAMO_RESPONDEU = "respondeu";

/**
 * "O vendedor respondeu?" — pergunta sobre mensagem de SAÍDA na conversa do
 * lead, não sobre o vendedor ter lido o aviso. Ler o aviso não atende ninguém;
 * o que o cliente percebe é a mensagem que chega.
 */
export const crmDonoRespondeu: FlowNodeDefinition<RespondeuConfig> = {
  type: "crm.owner_responded",
  version: 1,
  category: "crm",
  rotulo: "O vendedor já falou com o lead?",
  descricao: "Verifica se saiu alguma mensagem para o lead depois que ele foi distribuído.",
  configSchema: respondeuConfigSchema,
  branches: (): ReturnType<FlowNodeDefinition["branches"]> => [
    { id: RAMO_RESPONDEU, label: "Sim, já falou", kind: "match" },
    ramoPadrao("Ainda não falou"),
  ],
  execute: async (ctx, config): Promise<NodeExecutionResult> => {
    const lead = ctx.fatos.lead;
    if (lead === null) return { kind: "dead", reason: "sem_lead_para_conferir" };
    const desde =
      config.contar_a_partir_de === "desde_a_atribuicao"
        ? (ctx.escopo.vars.atribuido_em as string | undefined) ?? ctx.escopo.execution.started_at
        : ctx.escopo.execution.started_at;
    const falou = await ctx.crm.houveRespostaDoDono({ leadId: lead.id, desde });
    return { kind: "advance", branch_id: falou ? RAMO_RESPONDEU : "else" };
  },
};
