/**
 * O QUE PODE IR ENTRE `{{ }}` — a lista que a tela oferece.
 *
 * ## Por que isto não estava em lugar nenhum
 *
 * `RAIZES_DE_VARIAVEL` (`types.ts`) existe desde que o system prompt da IA
 * precisou saber o que autorizar, e o único consumidor dele é o prompt. Quem
 * monta o fluxo À MÃO nunca teve lista: cada formulário escrevia a própria frase
 * de ajuda ("Use {{lead.title}}, {{contact.name}} e {{lead.score}}"), e as
 * frases divergiam — o formulário de aviso citava três campos, o de envio
 * citava outros três, e nenhum dos dois mencionava `{{vars.*}}`, que é metade
 * do motivo de um fluxo ter mais de um bloco.
 *
 * O efeito prático é o pior tipo de defeito de produto: `{{lead.nome}}` (que não
 * existe; o campo é `title`) não dá erro nenhum. `interpolar` troca o marcador
 * ausente por VAZIO de propósito — mandar a chave crua ao cliente é pior que a
 * lacuna —, então a mensagem sai torta e ninguém fica sabendo.
 *
 * ## Raiz FECHADA e raiz ABERTA
 *
 * `lead`, `contact`, `assigned_user`, `execution` e `frame` têm forma conhecida:
 * são campos de `FatosDaExecucao` e `EscopoDaFrente`, e a lista aqui é o espelho
 * deles. `vars`, `event` e `global` não têm: guardam, respectivamente, o que os
 * blocos anteriores gravaram, o payload de quem disparou o fluxo e as variáveis
 * da organização. Inventar uma lista fixa para essas três mentiria — a tela
 * oferece a raiz e um campo para digitar o resto.
 *
 * ## A cerca
 *
 * `satisfies Record<keyof EscopoDeVariaveis, …>` é a mesma cerca de
 * `RAIZES_DE_VARIAVEL`, e pelo mesmo motivo: raiz nova na interface sem entrada
 * aqui NÃO COMPILA. Sem ela, o escopo cresceria e a tela continuaria oferecendo
 * o conjunto de ontem, em silêncio — que foi exatamente o que aconteceu com a
 * whitelist do prompt antes de a cerca existir.
 */

import type { EscopoDeVariaveis } from "./types";

/** Uma folha oferecida no seletor. `caminho` é relativo à raiz. */
export interface FolhaDeVariavel {
  /** O trecho depois da raiz: `title`, `custom_fields.orcamento`. */
  caminho: string;
  /** O que a pessoa lê. Em português de operação, não de schema. */
  rotulo: string;
}

export interface RaizDeVariavel {
  /** `lead`, `contact`… — o primeiro segmento do caminho. */
  raiz: string;
  /** O título do grupo no seletor. */
  rotulo: string;
  /** O que essa raiz é, em uma linha. */
  descricao: string;
  /**
   * `true` quando o conteúdo depende do fluxo e não do schema. A tela oferece a
   * raiz e deixa a pessoa completar; uma lista fixa aqui seria invenção.
   */
  aberta: boolean;
  folhas: readonly FolhaDeVariavel[];
}

const f = (caminho: string, rotulo: string): FolhaDeVariavel => ({ caminho, rotulo });

/**
 * O catálogo. A ordem é a de uso, não a alfabética: quem escreve uma mensagem
 * procura o nome do cliente antes do id da execução.
 */
export const CATALOGO_DE_VARIAVEIS = {
  contact: {
    raiz: "contact",
    rotulo: "Contato",
    descricao: "A pessoa do outro lado da conversa.",
    aberta: false,
    folhas: [
      f("name", "Nome"),
      f("phone_number", "Telefone"),
      f("email", "E-mail"),
      f("tags", "Marcadores"),
      f("id", "Id do contato"),
    ],
  },
  lead: {
    raiz: "lead",
    rotulo: "Lead",
    descricao: "O card do funil. Vazio quando o fluxo não nasceu de um lead.",
    aberta: false,
    folhas: [
      f("title", "Título"),
      f("status", "Situação"),
      f("value_cents", "Valor (em centavos)"),
      f("score", "Score de IA"),
      f("score_band", "Faixa do score"),
      f("source", "Origem"),
      f("tags", "Marcadores"),
      f("created_at", "Criado em"),
      f("stage_id", "Id da etapa"),
      f("pipeline_id", "Id do funil"),
      f("owner_user_id", "Id do dono"),
      f("id", "Id do lead"),
    ],
  },
  assigned_user: {
    raiz: "assigned_user",
    rotulo: "Quem atende",
    descricao: "O dono atual do lead. Vazio enquanto ninguém assumiu.",
    aberta: false,
    folhas: [
      f("name", "Nome"),
      f("notification_phone", "Telefone de aviso"),
      f("id", "Id da pessoa"),
    ],
  },
  vars: {
    raiz: "vars",
    rotulo: "Do fluxo",
    descricao: "O que os blocos anteriores gravaram nesta execução.",
    aberta: true,
    folhas: [],
  },
  global: {
    raiz: "global",
    rotulo: "Da empresa",
    descricao: "Variáveis da organização, iguais em todo fluxo dela.",
    aberta: true,
    folhas: [],
  },
  event: {
    raiz: "event",
    rotulo: "Do gatilho",
    descricao: "O payload de quem disparou o fluxo — a mensagem, o webhook.",
    aberta: true,
    folhas: [],
  },
  frame: {
    raiz: "frame",
    rotulo: "Deste caminho",
    descricao: "O que é desta frente, e não da execução inteira.",
    aberta: false,
    folhas: [
      f("loop_index", "Posição no laço (começa em 0)"),
      f("loop_total", "Quantos itens o laço tem"),
    ],
  },
  execution: {
    raiz: "execution",
    rotulo: "Da execução",
    descricao: "A execução em si — útil para depurar, raro numa mensagem.",
    aberta: false,
    folhas: [
      f("started_at", "Começou em"),
      f("steps_taken", "Passos já dados"),
      f("id", "Id da execução"),
    ],
  },
} as const satisfies Record<keyof EscopoDeVariaveis, RaizDeVariavel>;

/** O catálogo na ordem de uso, para a tela iterar sem conhecer as chaves. */
export const RAIZES_EM_ORDEM: readonly RaizDeVariavel[] = Object.values(CATALOGO_DE_VARIAVEIS);

/**
 * O caminho completo de uma folha. Existe como função para a tela não montar
 * `raiz + "." + caminho` em cinco lugares e errar o ponto num deles.
 */
export function caminhoCompleto(raiz: string, caminho: string): string {
  return caminho === "" ? raiz : `${raiz}.${caminho}`;
}

/**
 * Os campos declarativos do funil viram folhas de `lead.custom_fields`.
 *
 * Eles são a metade do catálogo que NÃO cabe numa constante: cada instalação
 * tem os seus (`pipelines.settings.fields`), e é justamente onde mora o dado
 * do nicho — "número do pedido", "data da consulta", "metragem do imóvel". Sem
 * isto o seletor ofereceria o schema do produto e escondia o do cliente.
 */
export function folhasDeCamposDoFunil(
  campos: readonly { key: string; label: string }[],
): FolhaDeVariavel[] {
  const vistos = new Set<string>();
  const out: FolhaDeVariavel[] = [];
  for (const campo of campos) {
    if (vistos.has(campo.key)) continue;
    vistos.add(campo.key);
    out.push(f(`custom_fields.${campo.key}`, campo.label));
  }
  return out;
}
