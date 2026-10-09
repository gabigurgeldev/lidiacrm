/**
 * Um fluxo é INTERATIVO quando fala com o cliente da conversa: manda mensagem,
 * faz pergunta, mostra menu.
 *
 * É a linha que o coordenador de atendimento (migration 0229) traça entre os
 * dois tipos de fluxo que uma mensagem pode armar:
 *
 *   - interativo: disputa a conversa com o agente. Com o coordenador ativo, só
 *     ele decide se este fluxo conduz — o gatilho de mensagem não o arma por
 *     conta própria, senão o cliente ouviria duas vozes;
 *   - de bastidor (marcar, atribuir, avisar a equipe): não fala com ninguém e
 *     segue armando como sempre.
 *
 * A lista é de TIPOS de bloco, não de categoria: `whatsapp.notify_user` é da
 * categoria whatsapp e fala com a EQUIPE, e `whatsapp.bulk_send` é campanha —
 * nenhum dos dois disputa a conversa.
 */
import { flowGraphSchema } from "./graph-schema";

export const TIPOS_QUE_FALAM_COM_O_CLIENTE: ReadonlySet<string> = new Set([
  "whatsapp.send_to_lead",
  "logic.ask",
  "logic.choice_menu",
]);

export function fluxoEhInterativo(graph: unknown): boolean {
  const parsed = flowGraphSchema.safeParse(graph);
  // Grafo ilegível: na dúvida, trata como interativo — armar um fluxo que
  // fala por cima do coordenador é pior do que deixar de armar um de bastidor.
  if (!parsed.success) return true;
  return parsed.data.nodes.some((n) => TIPOS_QUE_FALAM_COM_O_CLIENTE.has(n.type));
}
