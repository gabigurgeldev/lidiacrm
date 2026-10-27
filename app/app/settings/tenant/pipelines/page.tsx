import { redirect } from "next/navigation";

/**
 * A página "Colunas dos Kanbans" foi extinta em 2026-10-27, por decisão do dono
 * do produto: colunas, papel de fechamento/perda, passo do agente e campos se
 * configuram DENTRO do Kanban, no painel Configurar (`?configurar=colunas`).
 *
 * A rota fica como redirecionamento para não quebrar link salvo, tutorial
 * antigo e favorito — mesmo padrão de `settings/tenant/whatsapp` — e está na
 * NAV_ALLOWLIST de `tests/unit/navegacao-completude.test.ts` por isso.
 */
export default function ColunasDosKanbansExtinta(): never {
  redirect("/app/kanban");
}
