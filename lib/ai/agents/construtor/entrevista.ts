/**
 * A entrevista do construtor: o que perguntar ao dono, e como.
 *
 * O banco de perguntas é um CHECKLIST para o modelo, não um formulário: o dono
 * já contou muita coisa no texto que colou, e perguntar de novo o que ele disse
 * é a forma mais rápida de fazê-lo desistir. O modelo confere o checklist contra
 * o material e pergunta só o que falta — e, entre o que falta, só o que muda o
 * agente.
 *
 * Regras de ritmo, todas medidas em quem desenha agentes para negócio:
 *  - até 4 perguntas por rodada, agrupadas por assunto;
 *  - pergunta fechada (opções) quando der, com uma sugestão que o dono aceita
 *    com um clique;
 *  - no máximo `MAX_RODADAS` rodadas — o resto vira lacuna declarada, e o
 *    agente transfere esse assunto para uma pessoa em vez de inventar.
 */
import type { Nicho } from "./nicho";

/** Rodadas de perguntas antes de o servidor encerrar a entrevista sozinho. */
export const MAX_RODADAS = 3;

/** Perguntas por rodada. Mais que isso vira formulário. */
export const MAX_PERGUNTAS_POR_RODADA = 4;

export const BANCO_DE_PERGUNTAS: ReadonlyArray<{ assunto: string; perguntas: readonly string[] }> = [
  {
    assunto: "Negócio",
    perguntas: [
      "Nome da empresa e o que ela faz, em uma frase",
      "Cidade e área atendida; endereço se atende presencialmente",
      "Horário de atendimento",
      "O diferencial — por que comprar aqui e não no concorrente",
    ],
  },
  {
    assunto: "Objetivo do agente",
    perguntas: [
      "O que o agente deve conseguir: agendar, vender, qualificar e passar ao vendedor, ou tirar dúvidas e dar suporte",
      "Como a conversa termina bem: link de pagamento, horário marcado, transferência para quem",
      "Que dados coletar do cliente (só o necessário)",
    ],
  },
  {
    assunto: "Oferta",
    perguntas: [
      "Produtos ou serviços principais, com preço",
      "O preço pode ser dito no chat? (valor exato, 'a partir de', ou só com orçamento)",
      "Desconto máximo que o agente pode dar, ou nenhum",
    ],
  },
  {
    assunto: "Pagamento e políticas",
    perguntas: [
      "Formas de pagamento, parcelas, sinal",
      "Entrega/prazo, troca e devolução, cancelamento, reagendamento e falta, garantia",
    ],
  },
  {
    assunto: "Cliente e qualificação",
    perguntas: [
      "Quem é o cliente típico e as dúvidas mais comuns",
      "O que define um bom cliente e as perguntas que separam ele dos curiosos",
      "As objeções que mais aparecem e a resposta que funciona",
    ],
  },
  {
    assunto: "Tom",
    perguntas: [
      "Nome do agente",
      "Jeito de falar: formal ou informal, com ou sem emoji, três adjetivos",
      "Palavras ou promessas proibidas",
    ],
  },
  {
    assunto: "Passar para uma pessoa",
    perguntas: [
      "Assuntos que sempre vão para uma pessoa",
      "Quem atende e em que horário; o que dizer fora desse horário",
    ],
  },
];

const PRIORIDADE_POR_NICHO: Record<Nicho, string> = {
  clinica:
    "Para saúde e bem-estar, priorize: especialidades/profissionais, convênio ou particular, se o preço pode ser dito, política de falta e reagendamento.",
  imobiliaria:
    "Para imobiliária, priorize: compra, aluguel ou os dois, regiões atendidas, faixa de valores, e o que acontece depois da qualificação (visita, corretor).",
  curso:
    "Para curso/infoproduto, priorize: o que o aluno recebe, preço e parcelas, garantia e reembolso, objeções mais comuns.",
  servicos:
    "Para serviços, priorize: o que está incluso, como sai o orçamento, área de atendimento, prazo de execução e garantia.",
  loja: "Para loja/e-commerce, priorize: catálogo e preços, frete e prazo, troca e devolução, formas de pagamento.",
  generico: "Priorize o objetivo do agente, a oferta com preço e o que vai para uma pessoa.",
};

/** O system prompt do passo que decide se ainda precisa perguntar. */
export function promptDaEntrevista(nicho: Nicho, rodada: number): string {
  const checklist = BANCO_DE_PERGUNTAS.map(
    (b) => `${b.assunto}:\n${b.perguntas.map((p) => `- ${p}`).join("\n")}`,
  ).join("\n\n");
  const ultima = rodada >= MAX_RODADAS;
  return [
    "Você entrevista o dono de um negócio para montar um agente de atendimento por WhatsApp.",
    "Você recebe o material que ele colou e as respostas que ele já deu. Decida: ainda falta algo que MUDA o agente, ou já dá para montar?",
    `CHECKLIST do que um bom agente precisa saber:\n\n${checklist}`,
    PRIORIDADE_POR_NICHO[nicho],
    [
      "REGRAS:",
      "- Nunca pergunte o que já está no material ou nas respostas. Releia antes de perguntar.",
      `- No máximo ${MAX_PERGUNTAS_POR_RODADA} perguntas, curtas, em português, do assunto mais importante para o menos.`,
      "- Prefira pergunta com opções (de 2 a 5). Use resposta_livre=true só quando a resposta não cabe numa lista (preços, nomes, horários).",
      "- Quando houver um padrão razoável, preencha 'sugestao' com ele, para o dono aceitar com um clique.",
      "- Se o essencial já está coberto (o que vende, para quem, objetivo do agente e quando passar para uma pessoa), responda kind='pronto'. Detalhe que falta vira lacuna, não pergunta.",
      "- Em 'nicho', classifique o negócio.",
      "- Em 'resumo' (obrigatório quando kind='pronto'), descreva em até 2 frases o agente que será montado.",
      ultima
        ? "- ESTA É A ÚLTIMA RODADA: responda kind='pronto'."
        : `- Esta é a rodada ${rodada} de no máximo ${MAX_RODADAS}.`,
    ].join("\n"),
  ].join("\n\n");
}
