/**
 * QUAIS SKILLS O AGENTE GANHA POR RAMO DE NEGÓCIO.
 *
 * Fonte única da lista padrão: o modelo de agente do formulário
 * (`lib/ai/agents/modelos-por-nicho.ts`) e o "Criar com IA"
 * (`lib/ai/agents/construtor/criar.ts`) gravam esta lista em
 * `ai_agent_versions.skill_names` quando o agente nasce de um ramo — é a
 * "instalação automática". O dono liga e desliga depois, na tela do agente.
 *
 * Só entram aqui skills de NICHO. As universais (objeção de preço,
 * agendamento, cliente insatisfeito, comprovante, LGPD, retomada, risco à
 * vida) valem para todo agente sem estar em lista nenhuma — ver `loadSkills`
 * em `lib/agent-engine/agent/skills.ts`.
 *
 * Cada nome tem de existir como skill de plataforma semeada no
 * `supabase/baseline.sql` com o ramo em `nichos` (migration 0242). Vigiado por
 * `tests/unit/skills-por-nicho.test.ts`.
 */
import type { Nicho } from "@/lib/ai/agents/construtor/nicho";

export const SKILLS_POR_NICHO: Readonly<Record<Nicho, readonly string[]>> = {
  clinica: ["clinica-sinais-de-urgencia", "clinica-convenio-e-particular", "clinica-exames-e-resultados"],
  imobiliaria: ["imobiliaria-qualificacao", "imobiliaria-financiamento", "imobiliaria-locacao-garantias"],
  servicos: ["servicos-orcamento", "servicos-retrabalho"],
  curso: [
    "curso-e-para-mim",
    "curso-promessa-de-resultado",
    "curso-acesso-a-plataforma",
    "curso-reembolso-e-garantia",
  ],
  loja: ["loja-rastreio-de-pedido", "loja-produto-com-problema", "loja-estoque-e-variacoes", "loja-frete-e-entrega"],
  generico: [],
};

/** Lista padrão de skills de nicho para um ramo (cópia — o chamador pode mexer). */
export function skillsPadraoDoNicho(nicho: Nicho): string[] {
  return [...SKILLS_POR_NICHO[nicho]];
}

/**
 * O `skill_names` que um agente recém-criado grava. Ramo genérico (ou sem
 * ramo) fica `null` — o padrão, que dá universais + skills da organização —
 * em vez de `[]`, que desligaria as skills que a organização instalou.
 */
export function skillNamesDoNovoAgente(nicho: Nicho | null | undefined): string[] | null {
  if (!nicho || nicho === "generico") return null;
  return skillsPadraoDoNicho(nicho);
}
