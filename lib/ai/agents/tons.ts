/**
 * O jeito de falar do funcionário.
 *
 * Morava dentro da ação do onboarding (`createDefaultAgent.ts`). Saiu para cá
 * quando os modelos por nicho (`modelos-por-nicho.ts`) passaram a precisar do
 * MESMO tom: duas cópias do parágrafo divergiriam no primeiro ajuste de texto,
 * e o agente do onboarding falaria diferente do agente criado pelo modelo com o
 * mesmo tom escolhido.
 *
 * Os corpos diziam "loja online" e "e-commerce" em dois dos três — num produto
 * que se declara multi-nicho por escrito, e cuja maioria de adopters roda em
 * clínica, imobiliária e infoproduto. Uma clínica terminava o onboarding com um
 * atendente que se apresentava como sendo de uma loja virtual.
 *
 * Recebem o nome do negócio E o ramo: um funcionário que sabe onde trabalha é o
 * mínimo que se espera de alguém contratado, e saber o QUE o lugar faz é a
 * diferença entre "Olá, como posso ajudar?" e uma primeira frase que já mostra
 * que ele entendeu onde está. O ramo é o que o dono respondeu no primeiro passo;
 * quem não respondeu recebe a versão sem ele, e não uma inventada.
 *
 * As chaves continuam as do onboarding (`PROMPT_TEMPLATES`): elas estão gravadas
 * em `organizations.onboarding_state.ai.prompt_template` de quem já instalou.
 */
import type { PromptTemplate } from "@/lib/schemas/onboarding";

export function ondeTrabalha(negocio: string, oQueFaz: string | undefined): string {
  return oQueFaz ? `${negocio}, que é: ${oQueFaz}` : negocio;
}

export const PROMPT_BODIES: Record<PromptTemplate, (onde: string) => string> = {
  ecommerce_friendly: (n) =>
    `Você atende os clientes de ${n}. Fale de forma calorosa e próxima, como alguém que gosta de ajudar. Cumprimente, entenda o que a pessoa precisa e ofereça opções claras. Confirme os detalhes antes de agir.`,
  ecommerce_professional: (n) =>
    `Você atende os clientes de ${n}. Fale de forma objetiva, cordial e profissional. Vá direto ao ponto, sem parecer frio, e sempre termine indicando o próximo passo.`,
  support_minimal: (n) =>
    `Você atende os clientes de ${n}. Responda em frases curtas, peça apenas o que for necessário e chame uma pessoa do time assim que a dúvida sair do seu alcance.`,
};

/**
 * O jeito de falar, não o "estilo de prompt" — como o tom aparece para quem
 * escolhe, no onboarding e nos modelos por nicho.
 *
 * Os rótulos anteriores eram "Amigável (e-commerce)", "Profissional" e "Suporte
 * minimalista" — dois deles amarrados a loja virtual, num produto cuja maioria
 * de adopters roda em clínica, imobiliária e infoproduto. Os identificadores
 * continuam os mesmos porque já existem gravados; só a fala mudou.
 */
export const JEITOS_DE_FALAR: ReadonlyArray<{ id: PromptTemplate; titulo: string; desc: string }> = [
  {
    id: "ecommerce_friendly",
    titulo: "Próximo e caloroso",
    desc: "Conversa como gente, puxa assunto, tranquiliza. Bom para quem vende no dia a dia.",
  },
  {
    id: "ecommerce_professional",
    titulo: "Objetivo e cordial",
    desc: "Vai direto ao ponto sem ser seco, e sempre indica o próximo passo.",
  },
  {
    id: "support_minimal",
    titulo: "Curto e prático",
    desc: "Frases curtas, pergunta só o essencial e chama uma pessoa cedo.",
  },
];
