/**
 * A recusa de `fn_conversation_assign` quando um `agent` tenta mexer no dono de
 * uma conversa que não pode ver (migration 0253).
 *
 * A função levanta SQLSTATE 42501 com a mensagem `conversation_not_visible`.
 * As rotas que trocam dono (transfer, claim, PATCH claimed) respondem 404
 * "Conversa não encontrada" — a MESMA resposta do GET para quem não enxerga a
 * conversa. Um 403 diria que o id existe, e é justamente isso que o modo de
 * visibilidade esconde.
 *
 * Conferimos a mensagem, não só o código: 42501 também é o "permission denied"
 * genérico do Postgres (função sem EXECUTE, por exemplo), e esse precisa
 * continuar saindo como 500 para alguém ver.
 */
export const CONVERSA_FORA_DE_ALCANCE = "conversation_not_visible";

export function conversaForaDeAlcance(
  erro: { code?: string | null; message?: string | null } | null | undefined,
): boolean {
  if (!erro) return false;
  return erro.code === "42501" && (erro.message ?? "").includes(CONVERSA_FORA_DE_ALCANCE);
}
