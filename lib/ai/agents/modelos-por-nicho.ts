/**
 * MODELOS DE AGENTE POR TIPO DE NEGÓCIO.
 *
 * Quem cria um agente pela tela começava de "Você é um atendente. Responda de
 * forma educada e clara" e de uma lista de campos — e o que separa um agente
 * útil de um genérico é justamente o que esse texto não diz: o que ele faz
 * neste ramo, o que ele nunca pode fazer, e quando deve chamar uma pessoa. Uma
 * clínica precisa que ele NUNCA dê diagnóstico; um curso, que ele nunca prometa
 * renda; uma loja, que ele não confirme estoque que não conhece.
 *
 * Os ramos são os MESMOS do quadro pronto do onboarding (`PACOTES` em
 * `lib/onboarding/pacotes-de-funil.ts`), e o jeito de falar é o MESMO do agente
 * do onboarding (`lib/ai/agents/tons.ts`). Um terceiro vocabulário de nichos
 * faria a clínica escolher "Clínica" num lugar e "Saúde" no outro.
 *
 * O modelo só PREENCHE o formulário: nada é salvo até o dono clicar em Criar, e
 * tudo continua editável. Por isso ele é puro — o chamador passa as capacidades
 * e o "onde trabalha", e recebe os campos.
 */
import { PACOTES, type PacoteDeFunil } from "@/lib/onboarding/pacotes-de-funil";
import { PROMPT_TEMPLATES, type PromptTemplate } from "@/lib/schemas/onboarding";

import { PROMPT_BODIES } from "./tons";

export type IdDoModelo = PacoteDeFunil["id"];

interface ConteudoDoModelo {
  nomeSugerido: string;
  /** Uma frase sobre o que este agente faz — vira a descrição do agente. */
  resumo: string;
  oQueFaz: string[];
  nuncaFaz: string[];
  quandoPassar: string[];
  /** Palavras que passam a conversa para uma pessoa na hora, sem o agente decidir. */
  palavrasDePassagem: string[];
}

const CONTEUDO: Record<string, ConteudoDoModelo> = {
  clinica: {
    nomeSugerido: "Recepção",
    resumo: "Tira dúvidas, entende o motivo do contato e ajuda a marcar o horário.",
    oQueFaz: [
      "Tira dúvidas sobre serviços, horários, endereço e valores usando o material da empresa.",
      "Entende o motivo do contato e ajuda a pessoa a marcar um horário.",
      "Antes de dizer que está marcado, confirma o nome, o serviço e o dia e horário escolhidos.",
    ],
    nuncaFaz: [
      "Nunca dá diagnóstico, orientação de tratamento ou indicação de remédio.",
      "Nunca confirma um horário que não foi registrado.",
      "Nunca informa preço que não esteja no material da empresa.",
    ],
    quandoPassar: [
      "Sintoma grave ou urgência: oriente a procurar atendimento de emergência e chame uma pessoa.",
      "Reclamação sobre um atendimento ou pedido de reembolso.",
    ],
    palavrasDePassagem: ["urgência", "emergência", "reclamação"],
  },
  imobiliaria: {
    nomeSugerido: "Atendimento de imóveis",
    resumo: "Entende o que a pessoa procura, apresenta imóveis e propõe a visita.",
    oQueFaz: [
      "Entende se a pessoa quer comprar ou alugar, a região, a faixa de valor, o número de quartos e o prazo.",
      "Apresenta os imóveis do material da empresa que combinam com o que ela procura.",
      "Propõe uma visita e pergunta o melhor dia e horário.",
    ],
    nuncaFaz: [
      "Nunca garante aprovação de financiamento.",
      "Nunca informa imóvel, valor ou condição que não esteja no material da empresa.",
      "Nunca negocia desconto ou aceita proposta em nome da imobiliária.",
    ],
    quandoPassar: [
      "A pessoa quer fazer uma proposta, falar de documentação ou de contrato.",
      "A pessoa pede para falar com o corretor.",
    ],
    palavrasDePassagem: ["proposta", "contrato", "falar com corretor"],
  },
  servicos: {
    nomeSugerido: "Orçamentos",
    resumo: "Entende o pedido e junta as informações para o orçamento.",
    oQueFaz: [
      "Entende o que a pessoa precisa, onde e para quando.",
      "Junta o que é preciso para orçar (fotos, medidas, endereço, quantidade).",
      "Explica como o atendimento funciona usando o material da empresa.",
    ],
    nuncaFaz: [
      "Nunca fecha preço sem as informações do pedido.",
      "Nunca promete prazo que não esteja no material da empresa.",
    ],
    quandoPassar: [
      "O pedido já tem as informações para o orçamento: passe para a equipe com um resumo.",
      "Reclamação ou acionamento de garantia de um serviço feito.",
    ],
    palavrasDePassagem: ["reclamação", "garantia"],
  },
  curso: {
    nomeSugerido: "Atendimento de matrículas",
    resumo: "Tira dúvidas sobre o curso e ajuda quem quer entrar.",
    oQueFaz: [
      "Explica conteúdo, formato, duração, acesso e formas de pagamento usando o material da empresa.",
      "Entende o objetivo da pessoa e diz com honestidade se o curso serve para ela.",
      "Envia o link de inscrição quando ele estiver no material da empresa.",
    ],
    nuncaFaz: [
      "Nunca promete resultado, renda ou aprovação.",
      "Nunca inventa bônus, desconto ou condição especial.",
      "Nunca pressiona a pessoa a decidir.",
    ],
    quandoPassar: [
      "Pedido de reembolso ou cancelamento.",
      "Problema de acesso que você não consegue resolver com o material da empresa.",
    ],
    palavrasDePassagem: ["reembolso", "cancelar", "não consigo acessar"],
  },
  loja: {
    nomeSugerido: "Vendas",
    resumo: "Ajuda a escolher o produto, informa frete e acompanha o pedido.",
    oQueFaz: [
      "Ajuda a escolher o produto (modelo, tamanho, cor) usando o material da empresa.",
      "Informa frete, prazo e formas de pagamento conforme o material da empresa.",
      "Ajuda a acompanhar um pedido já feito.",
    ],
    nuncaFaz: [
      "Nunca confirma estoque que não conhece.",
      "Nunca inventa preço, cupom ou promoção.",
      "Nunca promete data de entrega.",
    ],
    quandoPassar: ["Troca, devolução ou pedido com problema."],
    palavrasDePassagem: ["troca", "devolução", "reclamação"],
  },
  generico: {
    nomeSugerido: "Atendente",
    resumo: "Entende o que a pessoa precisa e responde com o material da empresa.",
    oQueFaz: [
      "Entende o que a pessoa precisa.",
      "Responde usando o material da empresa.",
      "Registra o interesse para a equipe dar sequência.",
    ],
    nuncaFaz: [
      "Nunca inventa informação que não esteja no material da empresa.",
      "Nunca promete o que depende da equipe.",
    ],
    quandoPassar: ["Você não sabe a resposta, ou a pessoa está insatisfeita."],
    palavrasDePassagem: ["reclamação"],
  },
};

export interface ModeloDeAgente extends ConteudoDoModelo {
  id: IdDoModelo;
  /** O mesmo texto do quadro pronto do onboarding ("Clínica, consultório ou salão"). */
  comoSeApresenta: string;
}

/** Um modelo por ramo, na ordem dos quadros prontos (o genérico por último). */
export const MODELOS_DE_AGENTE: readonly ModeloDeAgente[] = PACOTES.map((p) => {
  const conteudo = CONTEUDO[p.id];
  if (!conteudo) throw new Error(`ramo "${p.id}" sem modelo de agente`);
  return { id: p.id, comoSeApresenta: p.comoSeApresenta, ...conteudo };
});

export function acharModelo(id: string | null | undefined): ModeloDeAgente | null {
  return MODELOS_DE_AGENTE.find((m) => m.id === id) ?? null;
}

/** Os campos que o modelo preenche no formulário de novo agente. */
export interface CamposDoModelo {
  name: string;
  description: string;
  system_prompt: string;
  tool_ids: string[];
  handoff_keywords: string[];
}

/**
 * As palavras que todo agente já nasce reconhecendo (o padrão de
 * `handoff_keywords` em `lib/ai/agents/validation.ts`). O modelo SOMA as do
 * ramo a estas — trocá-las faria o cliente que escreve "falar com humano" numa
 * clínica deixar de ser atendido por uma pessoa.
 */
const PALAVRAS_DE_SEMPRE = ["falar com humano", "atendente", "pessoa real"];

function lista(itens: string[]): string {
  return itens.map((i) => `- ${i}`).join("\n");
}

export function montarModelo(
  modelo: ModeloDeAgente,
  tom: PromptTemplate,
  ctx: { onde: string; capacidades: string[] },
): CamposDoModelo {
  const system_prompt = [
    PROMPT_BODIES[tom](ctx.onde),
    `## O que você faz\n${lista(modelo.oQueFaz)}`,
    `## O que você nunca faz\n${lista(modelo.nuncaFaz)}`,
    `## Quando chamar uma pessoa\n${lista(modelo.quandoPassar)}`,
  ].join("\n\n");
  return {
    name: modelo.nomeSugerido,
    description: modelo.resumo,
    system_prompt,
    tool_ids: [...ctx.capacidades],
    handoff_keywords: [...new Set([...PALAVRAS_DE_SEMPRE, ...modelo.palavrasDePassagem])],
  };
}

/**
 * O que a URL da tela de novo agente pediu (`?modelo=…&tom=…`), já conferido.
 *
 * Valor desconhecido não é erro: é "sem modelo" e "tom padrão". Uma URL velha
 * ou digitada à mão abre a tela em branco, e não uma página de erro.
 */
export function escolhaDaUrl(params: { modelo?: string | string[]; tom?: string | string[] }): {
  modelo: ModeloDeAgente | null;
  tom: PromptTemplate;
} {
  const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const tom = um(params.tom);
  return {
    modelo: acharModelo(um(params.modelo)),
    tom: (PROMPT_TEMPLATES as readonly string[]).includes(tom ?? "") ? (tom as PromptTemplate) : PROMPT_TEMPLATES[0],
  };
}
