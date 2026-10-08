/**
 * QUANDO uma passagem para pessoa vira AVISO ao dono (`agent.handoff_requested`).
 *
 * O evento alimenta o gatilho de fluxo `trigger.ai_handoff`, que é o que manda o
 * WhatsApp pessoal do dono. Até aqui ele só nascia quando o item da Central era
 * INSERIDO — e o insert deduplica por "já existe item `open` deste contato".
 * Resultado medido em produção: um item esquecido aberto calava TODA passagem
 * seguinte do mesmo cliente. A Central ficava certa (um item por contato) e o
 * dono, cego justamente para o cliente que voltou a precisar.
 *
 * A regra agora separa as duas perguntas:
 *  - a Central segue deduplicando por item aberto (um cartão por pessoa esperando);
 *  - o AVISO sai por EPISÓDIO: o contato não estava em passagem antes desta
 *    chamada (ou o item da Central acabou de nascer), e não houve outro aviso do
 *    mesmo contato há menos de `COOLDOWN_DO_ANUNCIO_MS`.
 *
 * "Estava em passagem" é `force_human` ou conversa com silêncio `infinity` — o
 * silêncio de 5 min da resposta manual NÃO conta, porque não é passagem.
 *
 * O cooldown cobre o que a primeira condição não cobre: dois motores (sentimento
 * e o turno do agente) escalando o mesmo cliente no mesmo segundo, cada um lendo
 * "não estava em passagem" antes do outro gravar.
 */

/** Janela em que um segundo aviso do mesmo contato é tratado como o mesmo episódio. */
export const COOLDOWN_DO_ANUNCIO_MS = 60_000;

export function deveAnunciarPassagem(p: {
  /** O contato já estava em passagem ANTES desta chamada. */
  estavaEmPassagem: boolean;
  /** O item da Central foi criado agora (episódio novo pelo critério antigo). */
  itemDaCentralNasceu: boolean;
  /** Último `agent.handoff_requested` deste contato, se houver. */
  ultimoAnuncioEm: Date | null;
  agora: Date;
}): boolean {
  const episodioNovo = !p.estavaEmPassagem || p.itemDaCentralNasceu;
  if (!episodioNovo) return false;
  if (p.ultimoAnuncioEm === null) return true;
  return p.agora.getTime() - p.ultimoAnuncioEm.getTime() >= COOLDOWN_DO_ANUNCIO_MS;
}

/** O payload do aviso — o MESMO nos dois motores, porque o fluxo lê `{{event.*}}`. */
export function payloadDoAnuncio(p: {
  contactId: string;
  conversationId: string;
  leadId: string | null;
  reason: string;
  summary: string;
  leadAvisado: boolean | null;
}): Record<string, unknown> {
  return {
    contact_id: p.contactId,
    conversation_id: p.conversationId,
    lead_id: p.leadId,
    reason: p.reason,
    summary: p.summary,
    lead_avisado: p.leadAvisado,
  };
}
