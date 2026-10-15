/**
 * O cliente mandou FOTO neste turno? — a passagem determinística da migration 0243.
 *
 * Medido numa floricultura real (2026-10-15): cliente manda a foto de uma
 * planta e pergunta "vcs tem dessa??". O agente vê a foto e, sem o item no
 * acervo, oscila entre "vou confirmar" e um preço inventado. A regra "não
 * invente preço" mora só no prompt — nada no código liga o que a foto mostra
 * ao catálogo. Com `handoffOnCustomerImage` ligado, a foto vai para uma pessoa
 * ANTES do modelo: não depende de ele obedecer.
 *
 * "Neste turno" = as mensagens do cliente DEPOIS da última nossa. Uma foto
 * antiga, já respondida, não pode passar a conversa de novo a cada mensagem — e
 * depois que alguém devolve ao automático, a foto que motivou a passagem já
 * ficou para trás da resposta da pessoa.
 *
 * Só `image`. Figurinha é reação, não pergunta; e a resposta que CITA uma foto
 * nossa ("gostei desse") é texto — quem escolhe do nosso catálogo não precisa
 * sair do agente.
 */
import type { LeadContextMessage } from '../edge/crm/get-lead-context';

export function clienteMandouFoto(
  mensagens: ReadonlyArray<Pick<LeadContextMessage, 'direction' | 'type'>>,
): boolean {
  for (let i = mensagens.length - 1; i >= 0; i--) {
    const m = mensagens[i]!;
    if (m.direction === 'outbound') return false;
    if (m.type === 'image') return true;
  }
  return false;
}
