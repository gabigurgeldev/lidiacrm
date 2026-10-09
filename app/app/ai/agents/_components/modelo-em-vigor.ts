import type { AgentRow } from "@/hooks/ai/useAgent";

/**
 * A linha do modelo, dizendo o que está EM VIGOR.
 *
 * Três casos, e cada um existe por um motivo medido:
 *
 *  1. versão publicada → é ela que o runtime lê (`agent-config.ts`), então é ela
 *     que a lista mostra. `ai_agents.model` não é sincronizado ao publicar.
 *  2. `provedor/modelo` → o formato do `rag_bot` legado, onde a coluna É a fonte.
 *  3. id nu → como todo `mcp_agent` nasce (`createMcpAgentAction` grava o id do
 *     catálogo). Antes, o `split("/")[0]` devolvia o próprio modelo e a lista
 *     renderizava "claude-sonnet-4-6 · claude-sonnet-4-6".
 */
/**
 * De ONDE saiu a linha acima — para a tela poder dizer isso a quem olha.
 *
 * Enxertado do PR #267 (@Lucas-BritoDev), que trazia a mesma informação num
 * módulo próprio. A regra ficou a desta função (é a que está em vigor e trata o
 * id nu do `mcp_agent` recém-criado); o que veio de lá é a EXPLICAÇÃO, que aqui
 * não existia: "anthropic · claude-sonnet-5" sozinho não diz se é o que atende
 * o cliente ou o que ficou no rascunho — e essa é exatamente a confusão que
 * custou uma depuração no modelo errado.
 */
export function origemDoModelo(agent: AgentRow): "versao_publicada" | "cadastro" {
  return agent.versao_publicada?.model ? "versao_publicada" : "cadastro";
}

export function modeloEmVigor(agent: AgentRow): string {
  const publicada = agent.versao_publicada;
  if (publicada?.model) {
    return publicada.provider ? `${publicada.provider} · ${publicada.model}` : publicada.model;
  }
  const cadastro = agent.model?.trim() ?? "";
  if (cadastro === "") return "—";
  if (!cadastro.includes("/")) return cadastro;
  const [provedor, ...resto] = cadastro.split("/");
  return `${provedor} · ${resto.join("/")}`;
}
