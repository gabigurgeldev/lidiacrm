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

export interface PerguntaDeReserva {
  pergunta: string;
  opcoes?: readonly string[];
  sugestao?: string;
}

export interface BlocoDoChecklist {
  assunto: string;
  perguntas: readonly string[];
  /**
   * A pergunta que o SERVIDOR faz quando o modelo, pedido duas vezes, não
   * devolve pergunta nenhuma (`cobertura.ts`). Escrita pronta para a tela.
   */
  reserva: PerguntaDeReserva;
}

export const BANCO_DE_PERGUNTAS = [
  {
    assunto: "Negócio",
    perguntas: [
      "Nome da empresa e o que ela faz, em uma frase",
      "Cidade e área atendida; endereço se atende presencialmente",
      "Horário de atendimento",
      "O diferencial — por que comprar aqui e não no concorrente",
    ],
    reserva: { pergunta: "Qual o nome da empresa, o que ela faz e em que horário atende?" },
  },
  {
    assunto: "Objetivo do agente",
    perguntas: [
      "O que o agente deve conseguir: agendar, vender, qualificar e passar ao vendedor, ou tirar dúvidas e dar suporte",
      "Como a conversa termina bem: link de pagamento, horário marcado, transferência para quem",
      "Que dados coletar do cliente (só o necessário)",
    ],
    reserva: {
      pergunta: "O que o agente deve conseguir na conversa?",
      opcoes: ["Agendar horário", "Vender e mandar o link", "Qualificar e passar ao vendedor", "Tirar dúvidas e dar suporte"],
    },
  },
  {
    assunto: "Oferta",
    perguntas: [
      "Produtos ou serviços principais, com preço",
      "O preço pode ser dito no chat? (valor exato, 'a partir de', ou só com orçamento)",
      "Desconto máximo que o agente pode dar, ou nenhum",
    ],
    reserva: {
      pergunta: "O agente pode informar preço no chat?",
      opcoes: ["Sim, o valor exato", "Só 'a partir de'", "Não, só com orçamento da equipe"],
    },
  },
  {
    assunto: "Pagamento e políticas",
    perguntas: [
      "Formas de pagamento, parcelas, sinal",
      "Entrega/prazo, troca e devolução, cancelamento, reagendamento e falta, garantia",
    ],
    reserva: { pergunta: "Quais as formas de pagamento e a política de troca, cancelamento ou reagendamento?" },
  },
  {
    assunto: "Cliente e qualificação",
    perguntas: [
      "Quem é o cliente típico e as dúvidas mais comuns",
      "O que define um bom cliente e as perguntas que separam ele dos curiosos",
      "As objeções que mais aparecem e a resposta que funciona",
    ],
    reserva: { pergunta: "Qual a objeção que mais aparece (ex.: preço, prazo) e o que vocês respondem?" },
  },
  {
    assunto: "Tom",
    perguntas: [
      "Nome do agente",
      "Jeito de falar: formal ou informal, com ou sem emoji, três adjetivos",
      "Palavras ou promessas proibidas",
    ],
    reserva: {
      pergunta: "Como o agente deve falar com o cliente?",
      opcoes: ["Informal, com emoji", "Informal, sem emoji", "Formal, sem emoji"],
      sugestao: "Informal, sem emoji",
    },
  },
  {
    assunto: "Passar para uma pessoa",
    perguntas: [
      "Assuntos que sempre vão para uma pessoa",
      "Quem atende e em que horário; o que dizer fora desse horário",
    ],
    reserva: { pergunta: "Que assuntos devem sempre ir para uma pessoa da equipe, e em que horário ela atende?" },
  },
] as const satisfies ReadonlyArray<BlocoDoChecklist>;

export type Assunto = (typeof BANCO_DE_PERGUNTAS)[number]["assunto"];

export const ASSUNTOS: readonly Assunto[] = BANCO_DE_PERGUNTAS.map((b) => b.assunto);

/**
 * Sem estes o agente nasce errado, e não só incompleto: não sabe o que vende,
 * para quê, nem quando parar. A entrevista não encerra com algum deles em aberto.
 */
export const ASSUNTOS_ESSENCIAIS: readonly Assunto[] = ["Negócio", "Objetivo do agente", "Oferta", "Passar para uma pessoa"];

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

/**
 * O system prompt do passo que decide se ainda precisa perguntar.
 *
 * `rodada` é a rodada PEDIDA: 1, 2 e 3 perguntam (a 3 é a última de
 * perguntas); a partir de 4 o prompt manda encerrar. Quem decide de verdade é
 * `decidirRodada` (`cobertura.ts`) — o prompt só pede a cobertura com evidência
 * para o servidor ter com que decidir.
 */
export function promptDaEntrevista(nicho: Nicho, rodada: number): string {
  const checklist = BANCO_DE_PERGUNTAS.map(
    (b) => `${b.assunto}:\n${b.perguntas.map((p) => `- ${p}`).join("\n")}`,
  ).join("\n\n");
  const encerrar = rodada > MAX_RODADAS;
  const ultima = rodada === MAX_RODADAS;
  return [
    "Você entrevista o dono de um negócio para montar um agente de atendimento por WhatsApp.",
    "Você recebe o material que ele colou e as respostas que ele já deu. Primeiro confira o que já está coberto; depois pergunte o que falta e MUDA o agente.",
    `CHECKLIST do que um bom agente precisa saber:\n\n${checklist}`,
    PRIORIDADE_POR_NICHO[nicho],
    [
      "REGRAS:",
      `- Em 'cobertura', avalie CADA assunto do checklist (${ASSUNTOS.join(", ")}): 'coberto' só quando a resposta está escrita no material ou nas respostas — copie o trecho em 'evidencia'; 'parcial' quando há só parte; 'faltando' quando não há nada. Não deduza: o que não está escrito está faltando.`,
      "- Nunca pergunte o que já está coberto. Releia antes de perguntar.",
      `- No máximo ${MAX_PERGUNTAS_POR_RODADA} perguntas, curtas, em português, dos assuntos essenciais (${ASSUNTOS_ESSENCIAIS.join(", ")}) para os demais.`,
      "- Prefira pergunta com opções (de 2 a 5). Use resposta_livre=true só quando a resposta não cabe numa lista (preços, nomes, horários).",
      "- Quando houver um padrão razoável, preencha 'sugestao' com ele, para o dono aceitar com um clique.",
      "- kind='pronto' só quando todos os assuntos essenciais estão 'coberto'. Detalhe secundário que faltar vira lacuna, não pergunta.",
      "- Em 'nicho', classifique o negócio.",
      "- Em 'resumo' (obrigatório quando kind='pronto'), descreva em até 2 frases o agente que será montado.",
      "Exemplo: o material diz \"Floricultura em Curitiba, entregamos buquês\" e nada sobre preço nem sobre quando chamar alguém. Então Negócio='coberto' (evidência: \"Floricultura em Curitiba\"), Oferta='parcial', Passar para uma pessoa='faltando', e você pergunta sobre preço e sobre os assuntos que vão para a equipe.",
      encerrar
        ? "- A entrevista acabou: responda kind='pronto', com o resumo, e perguntas vazias."
        : ultima
          ? `- Esta é a última rodada de perguntas (${rodada} de ${MAX_RODADAS}): pergunte só o que mais muda o agente.`
          : `- Esta é a rodada ${rodada} de no máximo ${MAX_RODADAS}.`,
    ].join("\n"),
  ].join("\n\n");
}
