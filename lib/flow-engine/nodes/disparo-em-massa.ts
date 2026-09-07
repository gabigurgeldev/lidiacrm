/**
 * Flow Engine — o bloco que cria um DISPARO EM MASSA.
 *
 * ## Ele não dispara: ele cria a campanha
 *
 * Quem manda mensagem em massa é o motor de disparos (`lib/bulk-send/`), com o
 * ritmo, o teto diário, a janela e o opt-out que ele já aplica há tempo. Este
 * bloco monta a campanha pelo MESMO caminho que a tela usa
 * (`lib/bulk-send/criar-disparo.ts`) e para por aí.
 *
 * A alternativa — o bloco mandando as mensagens ele mesmo — reescreveria a
 * regra de quem-pode-receber num segundo lugar, e é essa regra que responde
 * "este contato pediu para parar". Duas versões dela é como uma instalação
 * manda campanha para quem pediu para sair.
 *
 * ## Por que ele NÃO começa o disparo por padrão
 *
 * `POST /api/v1/bulk-sends` cria em rascunho de propósito: o recorte da lista
 * ("412 vão receber · 88 fora, sendo 61 sem telefone") é a informação que muda
 * a decisão, e a pessoa só aperta o botão depois de ver.
 *
 * Um fluxo não tem ninguém olhando. Por isso o padrão aqui é o mesmo rascunho
 * MAIS um aviso na Central — alguém confere e decide. Quem quiser automático de
 * ponta a ponta liga `comecar_sozinho`, e aí é escolha declarada, não descuido.
 *
 * ## O laço que este bloco pode virar
 *
 * ⚠️ Um fluxo disparado por "mensagem recebida" com este bloco dentro cria uma
 * campanha por mensagem que chega. O teto de destinatários por disparo não
 * protege disso — cada campanha é pequena, e são MUITAS. O aviso na Central é o
 * que faz esse caso aparecer para alguém antes de virar conta no fim do mês.
 */

import { z } from "zod";

import {
  ramoDeExcecao,
  ramoPadrao,
  type FlowNodeDefinition,
  type NodeExecutionResult,
  type PedidoDeDisparo,
} from "../types";

const RAMO_NAO_CRIOU = "nao_criou";

/**
 * ⚠️ SCHEMA PLANO — nada de `z.discriminatedUnion`, nem aninhada.
 *
 * `lib/flow-engine/ai/schema-sem-uniao-na-raiz.test.ts` reprova união
 * discriminada em qualquer ponto de um `configSchema`: ela vira `oneOf` no JSON
 * Schema, e o provedor de saída estruturada recusa — o "Criar fluxo com IA"
 * quebra inteiro para quem usa modelo roteado.
 *
 * É por isso que a audiência aqui NÃO reusa `audienciaSchema` de
 * `lib/schemas/bulk-sends.ts`, que é exatamente essa união. A tradução para o
 * formato que a rota espera acontece no `execute`, num lugar só.
 */
export const disparoEmMassaConfigSchema = z
  .strictObject({
    /** Nome da campanha. Aceita `{{...}}` — ajuda a distinguir uma execução da outra. */
    nome: z.string().min(2).max(120).default("Disparo do fluxo"),
    /** A conexão por onde disparar. Obrigatória: campanha não escolhe número sozinha. */
    canal_id: z.string().uuid(),
    modo: z.enum(["freeform", "template"]).default("freeform"),
    /** Texto, quando o modo é livre. */
    texto: z.string().max(4096).default(""),
    /** Modelo aprovado, quando o modo é template. */
    modelo_nome: z.string().max(200).default(""),
    modelo_idioma: z.string().max(20).default(""),
    /** Valores das variáveis do modelo, por chave (`body_1`, `body_2`…). */
    modelo_valores: z.record(z.string(), z.string()).default({}),
    /**
     * De onde saem os destinatários.
     *
     * `tags` recorta a base viva a cada execução — é o que faz o fluxo mandar
     * para quem entrou depois. `lista_fixa` congela os contatos escolhidos no
     * editor (a planilha importada vira ids ali, não aqui: não há como subir
     * arquivo no meio de uma execução).
     */
    audiencia: z.enum(["tags", "lista_fixa"]).default("tags"),
    tags: z.array(z.string().min(1)).max(20).default([]),
    contatos: z.array(z.string().uuid()).max(5000).default([]),
    /** Segundos entre mensagens. O motor eleva ao piso do canal se for pouco. */
    intervalo_ms: z.number().int().min(1000).max(600_000).default(5_000),
    /** Ver o cabeçalho: por padrão a campanha nasce em rascunho e avisa alguém. */
    comecar_sozinho: z.boolean().default(false),
  })
  .superRefine((config, ctx) => {
    if (config.modo === "freeform" && config.texto.trim() === "") {
      ctx.addIssue({ code: "custom", path: ["texto"], message: "Escreva o texto da mensagem." });
    }
    if (config.modo === "template" && (config.modelo_nome === "" || config.modelo_idioma === "")) {
      ctx.addIssue({
        code: "custom",
        path: ["modelo_nome"],
        message: "Escolha o modelo aprovado e o idioma dele.",
      });
    }
    if (config.audiencia === "tags" && config.tags.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["tags"],
        message: "Escolha ao menos um marcador para recortar a lista.",
      });
    }
    if (config.audiencia === "lista_fixa" && config.contatos.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["contatos"],
        message: "Importe a planilha ou escolha os contatos da lista.",
      });
    }
  });

export type DisparoEmMassaConfig = z.infer<typeof disparoEmMassaConfigSchema>;

export const whatsappDisparoEmMassa: FlowNodeDefinition<DisparoEmMassaConfig> = {
  type: "whatsapp.bulk_send",
  version: 1,
  category: "whatsapp",
  rotulo: "Disparo em massa",
  descricao: "Cria uma campanha para muitos contatos de uma vez, pela conexão escolhida.",
  configSchema: disparoEmMassaConfigSchema,
  branches: (): ReturnType<FlowNodeDefinition["branches"]> => [
    ramoDeExcecao(RAMO_NAO_CRIOU, "Não deu para criar"),
    ramoPadrao("Depois de criar"),
  ],
  execute: async (ctx, config): Promise<NodeExecutionResult> => {
    const pedido: PedidoDeDisparo = {
      nome: ctx.render(config.nome),
      canalId: config.canal_id,
      modo: config.modo,
      texto: config.modo === "freeform" ? ctx.render(config.texto) : undefined,
      modeloNome: config.modo === "template" ? config.modelo_nome : undefined,
      modeloIdioma: config.modo === "template" ? config.modelo_idioma : undefined,
      // Os valores do modelo também passam por `render`: é assim que a campanha
      // leva o nome da empresa ou a data que um bloco anterior calculou.
      modeloValores: Object.fromEntries(
        Object.entries(config.modelo_valores).map(([k, v]) => [k, ctx.render(v)]),
      ),
      audiencia:
        config.audiencia === "tags"
          ? { tipo: "tags", tags: config.tags }
          : { tipo: "contatos", contatos: config.contatos },
      intervaloMs: config.intervalo_ms,
      comecarSozinho: config.comecar_sozinho,
    };

    const desfecho = await ctx.disparo.criar(pedido);

    if (desfecho.kind === "recusado") {
      // Recusa NÃO mata a execução: o resto do fluxo (marcar o lead, avisar o
      // vendedor) costuma continuar fazendo sentido sem a campanha.
      return {
        kind: "advance",
        branch_id: RAMO_NAO_CRIOU,
        vars: { disparo_recusado: desfecho.motivo },
      };
    }

    if (!desfecho.comecou) {
      // Rascunho criado: alguém precisa olhar. Sem este aviso a campanha ficaria
      // parada para sempre, e o fluxo teria "funcionado".
      await ctx.avisos.abrir({
        titulo: "Um disparo em massa espera revisão",
        corpo: `O fluxo criou a campanha "${pedido.nome}" com ${desfecho.vaoReceber} destinatário(s). Confira a lista e comece o disparo em Disparos.`,
        severidade: "warn",
        refId: desfecho.disparoId,
      });
    }

    return {
      kind: "advance",
      branch_id: "else",
      vars: {
        disparo_id: desfecho.disparoId,
        disparo_vao_receber: desfecho.vaoReceber,
        disparo_comecou: desfecho.comecou,
      },
    };
  },
};
