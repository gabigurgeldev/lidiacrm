/**
 * Flow Engine — PERGUNTAR e GUARDAR a resposta; ATUALIZAR o nome do cliente.
 *
 * Os dois blocos que faltavam para uma pré-triagem por fluxo (nome → sistema →
 * problema → agente). O menu (`logic.choice_menu`) já esperava uma ESCOLHA;
 * faltava esperar um TEXTO LIVRE e guardá-lo inteiro com um nome.
 *
 * `logic.await_event` fazia a espera, mas guardava só o payload do evento —
 * `body_preview`, cortado em 280 caracteres pelo gatilho do banco — e sem nome
 * próprio: a descrição do problema chegava pela metade, num lugar que a espera
 * seguinte sobrescrevia. Aqui o texto vem inteiro da porta
 * (`ctx.crm.textoDaMensagem`) e vai para `{{vars.<variavel>}}`.
 */

import { z } from "zod";

import {
  ramoDeExcecao,
  ramoPadrao,
  type FlowBranch,
  type FlowNodeDefinition,
  type NodeExecutionResult,
} from "../types";
import { mandarPergunta, RAMO_PERGUNTA_NAO_SAIU, textoDoEvento } from "./gatilhos-e-menu";

/** Onde o acordador deixa o payload do evento. Igual ao do menu. */
const VAR_DO_EVENTO = "evento";

const PRAZO_MINIMO_MS = 5 * 60_000;
const PRAZO_MAXIMO_MS = 30 * 24 * 60 * 60_000;

/** Nome de variável: o que `{{vars.x}}` alcança sem ambiguidade. */
const nomeDeVariavel = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,39}$/u, "Use letras minúsculas, números e _ (ex.: problema).");

// ──────────────────────────────── logic.ask ──────────────────────────────────

export const perguntarConfigSchema = z.strictObject({
  /** O que o cliente lê. Vazio = só espera (a pergunta saiu num bloco antes). */
  pergunta: z.string().max(1000).default(""),
  /** Por qual conexão a pergunta sai. `null` = a do cliente. */
  canal_id: z.string().uuid().nullable().default(null),
  /** Onde a resposta fica: `{{vars.<variavel>}}`. */
  variavel: nomeDeVariavel.default("resposta"),
  prazo_ms: z.number().int().min(PRAZO_MINIMO_MS).max(PRAZO_MAXIMO_MS).default(3_600_000),
});
export type PerguntarConfig = z.infer<typeof perguntarConfigSchema>;

export const RAMO_SEM_RESPOSTA = "nao_respondeu";

/** O que entra quando a resposta não tem texto (mídia sem transcrição). */
export const RESPOSTA_SEM_TEXTO = "(o cliente mandou uma mídia sem texto)";

export const logicAsk: FlowNodeDefinition<PerguntarConfig> = {
  type: "logic.ask",
  version: 1,
  category: "logic",
  rotulo: "Perguntar e guardar a resposta",
  descricao: "Faz uma pergunta, espera o cliente responder e guarda o texto numa variável.",
  configSchema: perguntarConfigSchema,
  branches: (): FlowBranch[] => [
    // Exceções, e não `match`: um fluxo de triagem quase sempre manda os dois
    // casos para o mesmo lugar que a resposta, e exigir ligação nas duas
    // travaria a publicação por casos que o operador não quer tratar.
    ramoDeExcecao(RAMO_SEM_RESPOSTA, "Não respondeu a tempo"),
    ramoDeExcecao(RAMO_PERGUNTA_NAO_SAIU, "A pergunta não saiu"),
    ramoPadrao("Depois de responder"),
  ],
  execute: async (ctx, config): Promise<NodeExecutionResult> => {
    if (ctx.esperaEmCurso !== null) {
      const evento = ctx.escopo.frame.vars[VAR_DO_EVENTO] as Record<string, unknown> | undefined;
      if (evento === undefined) return { kind: "advance", branch_id: RAMO_SEM_RESPOSTA };

      const messageId = typeof evento.message_id === "string" ? evento.message_id : null;
      const inteiro = messageId === null ? null : await ctx.crm.textoDaMensagem({ messageId });
      const texto = (inteiro ?? textoDoEvento(evento)).trim();
      return {
        kind: "advance",
        branch_id: "else",
        vars: { [config.variavel]: texto === "" ? RESPOSTA_SEM_TEXTO : texto },
      };
    }

    const naoSaiu = await mandarPergunta(ctx, config.pergunta, config.canal_id, "");
    if (naoSaiu !== null) {
      return { kind: "advance", branch_id: RAMO_PERGUNTA_NAO_SAIU, vars: { envio_recusado: naoSaiu } };
    }
    return {
      kind: "await_event",
      event_type: "message.received",
      // A resposta DESTE contato — o mesmo filtro raso do menu.
      match: ctx.fatos.contact === null ? {} : { contact_id: ctx.fatos.contact.id },
      timeout_at: new Date(ctx.agora().getTime() + config.prazo_ms),
      branch_on_timeout: RAMO_SEM_RESPOSTA,
    };
  },
};

// ──────────────────────────── crm.update_contact ─────────────────────────────

export const atualizarContatoConfigSchema = z.strictObject({
  /** O nome, normalmente uma variável que uma pergunta guardou. */
  nome: z.string().min(1).max(200).default("{{vars.nome}}"),
});
export type AtualizarContatoConfig = z.infer<typeof atualizarContatoConfigSchema>;

export const RAMO_SEM_CONTATO = "sem_contato";
export const RAMO_SEM_NOME = "sem_nome";

/** Nome que o cliente digitou cabe numa linha de tela; o resto é conversa. */
const LIMITE_DO_NOME = 80;

export const crmUpdateContact: FlowNodeDefinition<AtualizarContatoConfig> = {
  type: "crm.update_contact",
  version: 1,
  category: "crm",
  rotulo: "Atualizar o nome do cliente",
  descricao: "Grava no cadastro o nome que o cliente informou.",
  configSchema: atualizarContatoConfigSchema,
  mutaCrm: true,
  branches: (): FlowBranch[] => [
    ramoDeExcecao(RAMO_SEM_CONTATO, "Sem cliente na conversa"),
    ramoDeExcecao(RAMO_SEM_NOME, "Nome vazio"),
    ramoPadrao("Depois de atualizar"),
  ],
  execute: async (ctx, config): Promise<NodeExecutionResult> => {
    const contato = ctx.fatos.contact;
    if (contato === null) return { kind: "advance", branch_id: RAMO_SEM_CONTATO };

    const nome = ctx.render(config.nome).replace(/\s+/gu, " ").trim().slice(0, LIMITE_DO_NOME);
    // Variável que não existia volta do `render` como o próprio `{{...}}` ou
    // vazia — gravar isso apagaria o nome do perfil com lixo.
    if (nome === "" || nome.includes("{{") || nome === RESPOSTA_SEM_TEXTO) {
      return { kind: "advance", branch_id: RAMO_SEM_NOME };
    }
    await ctx.crm.atualizarNomeDoContato({ contactId: contato.id, nome });
    return { kind: "advance", branch_id: "else" };
  },
};
