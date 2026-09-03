/**
 * Flow Engine — mandar mensagem para o CLIENTE.
 *
 * ## O buraco que este arquivo fecha
 *
 * Até aqui o motor de fluxos não sabia falar com o cliente. O único bloco de
 * WhatsApp que existia (`whatsapp.notify_user`) avisa o VENDEDOR: manda para um
 * telefone da equipe, marcando o contato como interno justamente para o agente
 * de IA não puxar conversa com ele. Quem montava um fluxo via "Avisar o
 * vendedor no WhatsApp" e supunha, razoavelmente, que houvesse o outro lado.
 * Não havia — e a única forma de o fluxo falar com o cliente era não falar.
 *
 * ## Por que a escolha de canal é uma CONEXÃO, e não um tipo de canal
 *
 * O pedido foi "poder escolher se envio pelo número por QR, pela API oficial ou
 * pelo parceiro". A config guarda `canal_id`: a conexão concreta que a pessoa
 * escolheu na tela — não o tipo dela.
 *
 * As duas razões:
 *
 *   1. **Doutrina.** `docs/doctrine/restricao-de-canal.md`, invariante 1:
 *      nenhum arquivo fora de `lib/channels/` nomeia um canal. Guardar "oficial"
 *      aqui seria o motor sabendo COM QUEM se fala, em vez de por onde.
 *   2. **Ambiguidade.** Uma organização pode ter três números oficiais. "Manda
 *      pelo oficial" não diz por qual — e a resposta que o motor daria (o
 *      primeiro que achasse) é resposta por acaso de ordem.
 *
 * `null` mantém o que já existia: a primeira conexão viva da organização. É o
 * default para quem tem um número só e não quer decidir nada.
 */

import { z } from "zod";

import {
  ramoPadrao,
  TIPOS_DE_MENSAGEM_DO_FLUXO,
  type FlowNodeDefinition,
  type NodeExecutionResult,
} from "../types";

const RAMO_SEM_CONTATO = "sem_contato";
const RAMO_NAO_SAIU = "nao_saiu";

/**
 * ⚠️ SCHEMA PLANO, sem `z.discriminatedUnion` em ponto nenhum da árvore.
 *
 * Não é estilo: `lib/flow-engine/ai/schema-sem-uniao-na-raiz.test.ts` reprova
 * união discriminada dentro de um `configSchema`, porque ela vira `oneOf` no
 * JSON Schema e o provedor de saída estruturada recusa — o "Criar fluxo com IA"
 * quebraria inteiro, alto, para quem usa modelo roteado.
 *
 * O preço é que "tem mídia" não é garantido pelo tipo, e sim pelo `superRefine`
 * abaixo. Vale: um schema só para manter, em vez de um schema de runtime mais
 * outro simplificado só para a geração (o escape hatch de `CONFIG_PARA_GERACAO`).
 */
export const enviarAoClienteConfigSchema = z
  .strictObject({
    tipo: z.enum(TIPOS_DE_MENSAGEM_DO_FLUXO).default("texto"),
    /** Texto da mensagem, ou legenda da mídia. Aceita `{{lead.title}}` e afins. */
    texto: z.string().max(4000).default(""),
    /** Endereço público do arquivo, quando o tipo não é texto. */
    media_url: z.string().url().max(2000).optional(),
    /**
     * A conexão por onde mandar. `null` = a primeira viva da organização.
     *
     * Guarda o ID da conexão, nunca o tipo dela — ver o cabeçalho.
     */
    canal_id: z.string().uuid().nullable().default(null),
  })
  .superRefine((config, ctx) => {
    if (config.tipo === "texto") {
      if (config.texto.trim() === "") {
        ctx.addIssue({
          code: "custom",
          path: ["texto"],
          message: "Escreva a mensagem que o cliente vai receber.",
        });
      }
      return;
    }
    // Mídia sem endereço publica e falha no primeiro lead — e a causa fica
    // longe de quem montou. Barrar aqui é barrar na tela, antes de publicar.
    if (config.media_url === undefined || config.media_url.trim() === "") {
      ctx.addIssue({
        code: "custom",
        path: ["media_url"],
        message: "Informe o endereço do arquivo que será enviado.",
      });
    }
  });

export type EnviarAoClienteConfig = z.infer<typeof enviarAoClienteConfigSchema>;

export const whatsappEnviarAoCliente: FlowNodeDefinition<EnviarAoClienteConfig> = {
  type: "whatsapp.send_to_lead",
  version: 1,
  category: "whatsapp",
  rotulo: "Mandar mensagem para o cliente",
  descricao: "Manda texto, imagem, áudio, vídeo ou arquivo na conversa do cliente.",
  configSchema: enviarAoClienteConfigSchema,
  branches: (): ReturnType<FlowNodeDefinition["branches"]> => [
    // As duas saídas existem porque as duas acontecem, e por motivos que quem
    // monta o fluxo trata de formas diferentes: "não tem com quem falar" pede
    // outro caminho no funil; "não saiu agora" costuma pedir espera e retentativa.
    { id: RAMO_SEM_CONTATO, label: "Sem telefone do cliente", kind: "match" },
    { id: RAMO_NAO_SAIU, label: "Não saiu agora", kind: "match" },
    ramoPadrao("Depois de enviar"),
  ],
  execute: async (ctx, config): Promise<NodeExecutionResult> => {
    const contato = ctx.fatos.contact;
    if (contato === null || contato.phone_number === null) {
      return { kind: "advance", branch_id: RAMO_SEM_CONTATO };
    }

    const desfecho = await ctx.canal.enviarParaContato({
      contactId: contato.id,
      tipo: config.tipo,
      texto: ctx.render(config.texto),
      // A URL também passa por `render`: dá para montar o endereço com um dado
      // do lead (um contrato por cliente, por exemplo).
      ...(config.media_url === undefined ? {} : { mediaUrl: ctx.render(config.media_url) }),
      channelSessionId: config.canal_id,
    });

    if (desfecho.kind === "enviado") {
      return {
        kind: "advance",
        branch_id: "else",
        vars: { ultima_mensagem_id: desfecho.messageId },
      };
    }
    // `na_fila` NÃO é falha: a mensagem saiu do CRM e espera a vez no canal
    // (fora da janela, número em aquecimento). Tratá-la como erro faria o fluxo
    // desviar de um envio que vai acontecer.
    if (desfecho.kind === "na_fila") {
      return { kind: "advance", branch_id: "else", vars: { envio_na_fila: desfecho.motivo } };
    }
    return { kind: "advance", branch_id: RAMO_NAO_SAIU, vars: { envio_recusado: desfecho.motivo } };
  },
};
