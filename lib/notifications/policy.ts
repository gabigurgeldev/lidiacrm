export function shouldNotifyInbound(input: {
  direction?: string | null;
  conversationId?: string | null;
  openConversationId?: string | null;
  tabFocused: boolean;
  tipo?: unknown;
}): boolean {
  if (input.tipo === "reassinado") return false;
  if (input.direction !== "inbound") return false;
  if (!input.conversationId) return false;
  if (input.tabFocused && input.openConversationId === input.conversationId) return false;
  return true;
}

/**
 * A atribuição de uma conversa vira aviso de "lead novo para você"?
 *
 * Não avisa quem se atribuiu sozinho (clicou em "Assumir": já está olhando) nem
 * a conversa que a pessoa já tem aberta na aba focada. `release` (soltar a
 * conversa) não tem destinatário e nunca chega aqui com `toUserId` dela.
 */
export function deveAvisarLeadNovo(input: {
  toUserId?: string | null;
  userId: string;
  changedBy?: string | null;
  conversationId?: string | null;
  openConversationId?: string | null;
  tabFocused: boolean;
}): boolean {
  if (!input.conversationId) return false;
  if (input.toUserId !== input.userId) return false;
  if (input.changedBy && input.changedBy === input.userId) return false;
  if (input.tabFocused && input.openConversationId === input.conversationId) return false;
  return true;
}
