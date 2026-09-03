/**
 * Flow Engine — começar por MENSAGEM, e perguntar com opções.
 *
 * ## Os dois gatilhos novos, e por que eles são desiguais
 *
 * `trigger.message_received` é barato: o evento `message.received` já corre no
 * barramento, e `trigger-matcher.ts` arma todo fluxo cujo bloco de início
 * declara aquele tipo. Nada a inventar.
 *
 * `trigger.keyword` é o mesmo evento com uma pergunta a mais — "a mensagem
 * falava disto?" — e essa pergunta o matcher NÃO consegue fazer: ele enxerga o
 * `type` do bloco e nunca o `config` dele. Duas saídas existiam:
 *
 *   (a) o bloco decide no `execute` e morre quando não bate;
 *   (b) o matcher ganha um pré-filtro por config.
 *
 * Está implementada a (a). O preço é honesto e mensurável: uma execução
 * NASCIDA MORTA por mensagem que não bate, em toda organização que tenha um
 * fluxo por palavra-chave. A (b) é mais barata em escala e mexe numa interface
 * que todo nó implementa — troca que só se paga com volume medido, e não há
 * volume ainda. O comentário fica aqui para que a troca, quando vier, seja
 * decisão e não descoberta.
 *
 * ## O menu de escolha
 *
 * Ele reusa a MÁQUINA de espera do `logic.await_event` (dormir esperando
 * `message.received`, acordar com o payload no espaço da frente) e NÃO reusa a
 * regra de casamento: o filtro raso daquele bloco responde "é a conversa
 * certa?", e não "o que a pessoa escreveu bate com alguma opção?". A segunda é
 * texto livre contra N rótulos, e isso é lógica do bloco.
 */

import { z } from "zod";

import { ramoPadrao, type FlowBranch, type FlowNodeDefinition, type NodeExecutionResult } from "../types";

/** Onde o acordador deixa o payload do evento. Igual ao do `logic.await_event`. */
const VAR_DO_EVENTO = "evento";

// ─────────────────────── trigger.message_received ────────────────────────────

export const triggerMessageReceived: FlowNodeDefinition<Record<string, never>> = {
  type: "trigger.message_received",
  version: 1,
  category: "trigger",
  rotulo: "Quando o cliente manda mensagem",
  descricao: "Começa o fluxo toda vez que chega mensagem de um cliente.",
  eventos: ["message.received"],
  configSchema: z.strictObject({}),
  branches: () => [ramoPadrao("Começa aqui")],
  execute: async () => ({ kind: "advance", branch_id: "else" }),
};

// ───────────────────────────── trigger.keyword ───────────────────────────────

export const gatilhoPorPalavraConfigSchema = z.strictObject({
  /** As palavras que fazem o fluxo começar. Qualquer uma basta. */
  palavras: z.array(z.string().min(1).max(60)).min(1).max(20).default([]),
  /**
   * `contem` casa no meio da frase; `exata` exige que a mensagem inteira seja a
   * palavra. A segunda serve a menu numérico ("1", "2") — com `contem`, "10
   * reais" dispararia a opção "1".
   */
  modo: z.enum(["contem", "exata"]).default("contem"),
});
export type GatilhoPorPalavraConfig = z.infer<typeof gatilhoPorPalavraConfigSchema>;

/**
 * Compara sem acento e sem caixa.
 *
 * "Orçamento" e "orcamento" são a mesma palavra para quem digita no WhatsApp, e
 * exigir o acento faria o gatilho falhar justamente para quem escreve com
 * pressa — a maioria.
 */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .trim();
}

export function mensagemCasa(
  texto: string,
  palavras: readonly string[],
  modo: "contem" | "exata",
): boolean {
  const alvo = normalizar(texto);
  if (alvo === "") return false;
  return palavras.some((p) => {
    const palavra = normalizar(p);
    if (palavra === "") return false;
    return modo === "exata" ? alvo === palavra : alvo.includes(palavra);
  });
}

/** O texto da mensagem, de onde quer que o evento o tenha posto. */
function textoDoEvento(evento: Record<string, unknown>): string {
  for (const chave of ["body", "text", "message", "conteudo"]) {
    const valor = evento[chave];
    if (typeof valor === "string" && valor.trim() !== "") return valor;
  }
  return "";
}

export const triggerKeyword: FlowNodeDefinition<GatilhoPorPalavraConfig> = {
  type: "trigger.keyword",
  version: 1,
  category: "trigger",
  rotulo: "Quando o cliente escrever uma palavra",
  descricao: "Começa o fluxo quando a mensagem do cliente traz uma das palavras que você listar.",
  eventos: ["message.received"],
  configSchema: gatilhoPorPalavraConfigSchema,
  branches: () => [ramoPadrao("Começa aqui")],
  execute: async (ctx, config): Promise<NodeExecutionResult> => {
    const texto = textoDoEvento(ctx.escopo.event);
    if (!mensagemCasa(texto, config.palavras, config.modo)) {
      // `dead`, e não `fail`: não houve erro nenhum. A mensagem simplesmente
      // não era para este fluxo — ver a nota do cabeçalho sobre o custo disto.
      return { kind: "dead", reason: "mensagem_sem_a_palavra" };
    }
    return { kind: "advance", branch_id: "else" };
  },
};

// ──────────────────────────── logic.choice_menu ──────────────────────────────

const PRAZO_MINIMO_MS = 5 * 60_000;
const PRAZO_MAXIMO_MS = 30 * 24 * 60 * 60_000;

export const menuConfigSchema = z.strictObject({
  /**
   * As opções. `id` é estável e é o que a ligação no quadro guarda — derivá-lo
   * do rótulo faria renomear a opção soltar a linha.
   */
  opcoes: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(64),
        label: z.string().min(1).max(60),
        /** O que a pessoa pode escrever para escolher esta opção. */
        aceita: z.array(z.string().min(1).max(60)).min(1).max(10),
      }),
    )
    .min(1)
    .max(10)
    .default([]),
  modo: z.enum(["contem", "exata"]).default("exata"),
  prazo_ms: z.number().int().min(PRAZO_MINIMO_MS).max(PRAZO_MAXIMO_MS).default(3_600_000),
});
export type MenuConfig = z.infer<typeof menuConfigSchema>;

export const RAMO_NAO_RESPONDEU = "nao_respondeu";
/** Respondeu, mas nada bateu. É o `else`: o pega-tudo do bloco. */
export const RAMO_NAO_ENTENDI = "else";

export const logicChoiceMenu: FlowNodeDefinition<MenuConfig> = {
  type: "logic.choice_menu",
  version: 1,
  category: "logic",
  rotulo: "Esperar uma escolha",
  descricao: "Espera a resposta do cliente e segue pelo caminho da opção que ele escolheu.",
  configSchema: menuConfigSchema,
  branches: (config): FlowBranch[] => [
    ...(config?.opcoes ?? []).map((o) => ({ id: o.id, label: o.label, kind: "match" as const })),
    // "Não respondeu" é saída PRÓPRIA, separada de "respondeu e não entendi".
    // São decisões diferentes do funil: o silêncio pede insistir; a resposta
    // fora do menu pede repetir a pergunta de outro jeito. É a mesma separação
    // que `logic.await_event` faz entre chegar e vencer o prazo.
    { id: RAMO_NAO_RESPONDEU, label: "Não respondeu a tempo", kind: "match" },
    ramoPadrao("Não entendi a resposta"),
  ],
  execute: async (ctx, config): Promise<NodeExecutionResult> => {
    if (ctx.esperaEmCurso !== null) {
      const evento = ctx.escopo.frame.vars[VAR_DO_EVENTO];
      if (evento === undefined) {
        // Acordou pelo relógio: ninguém respondeu.
        return { kind: "advance", branch_id: RAMO_NAO_RESPONDEU };
      }

      const texto = textoDoEvento(evento as Record<string, unknown>);
      const escolhida = config.opcoes.find((o) => mensagemCasa(texto, o.aceita, config.modo));

      if (escolhida === undefined) {
        return {
          kind: "advance",
          branch_id: RAMO_NAO_ENTENDI,
          vars: { menu_resposta: texto },
        };
      }
      return {
        kind: "advance",
        branch_id: escolhida.id,
        vars: { menu_escolha: escolhida.id, menu_resposta: texto },
      };
    }

    // ⚠️ Este bloco NÃO manda a pergunta. Quem manda é o bloco de envio antes
    // dele — separar os dois é o que permite a pergunta ser texto, imagem ou
    // modelo aprovado sem este bloco saber nada de canal.
    return {
      kind: "await_event",
      event_type: "message.received",
      // Filtro raso: a resposta DESTE contato, não a de qualquer um. Sem ele, a
      // mensagem de um cliente escolheria a opção na conversa de outro — o pior
      // tipo de vazamento entre conversas, porque não é de dado, é de conduta.
      match: ctx.fatos.contact === null ? {} : { contact_id: ctx.fatos.contact.id },
      timeout_at: new Date(ctx.agora().getTime() + config.prazo_ms),
      branch_on_timeout: RAMO_NAO_RESPONDEU,
    };
  },
};

// ──────────────────────────── trigger.webhook ────────────────────────────────

export const gatilhoPorWebhookConfigSchema = z.strictObject({
  /**
   * Um nome para a pessoa reconhecer o token na lista de webhooks. Não afeta
   * comportamento — o que endereça é o `path_token`, gerado no servidor.
   */
  nome: z.string().min(2).max(120).default("Gatilho do fluxo"),
});
export type GatilhoPorWebhookConfig = z.infer<typeof gatilhoPorWebhookConfigSchema>;

/**
 * `trigger.webhook` — um sistema de fora começa o fluxo.
 *
 * ## Por que ele NÃO passa pelo matcher de eventos
 *
 * Todo outro gatilho é BROADCAST: o evento acontece, e `trigger-matcher.ts` arma
 * TODO fluxo que declarou aquele tipo. Aqui a chave é a identidade: um token
 * secreto pertence a UM fluxo, e só ele deve acordar. Forçar isso pelo
 * barramento exigiria um tipo de evento sintético por fluxo — ou ensinar o
 * matcher a ler config, que é a interface que todo nó implementa.
 *
 * Por isso o caminho é próprio: `app/api/v1/webhooks/flow/[token]` resolve o
 * token e cria a execução direto, do mesmo formato que o matcher cria.
 *
 * O bloco em si não decide nada — como `trigger.lead_created`, ele existe para
 * o grafo ter ponto de entrada e para a pessoa ler de onde o fluxo vem.
 */
export const triggerWebhook: FlowNodeDefinition<GatilhoPorWebhookConfig> = {
  type: "trigger.webhook",
  version: 1,
  category: "trigger",
  rotulo: "Quando outro sistema chamar",
  descricao: "Começa o fluxo quando um sistema de fora chama o endereço deste gatilho.",
  // Sem `eventos`: ele não escuta o barramento. Ver o cabeçalho.
  configSchema: gatilhoPorWebhookConfigSchema,
  branches: () => [ramoPadrao("Começa aqui")],
  execute: async () => ({ kind: "advance", branch_id: "else" }),
};
