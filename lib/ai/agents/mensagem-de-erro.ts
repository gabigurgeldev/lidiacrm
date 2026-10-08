/**
 * O código de erro do servidor, dito para quem configura o agente.
 *
 * O editor mostrava o código cru — "Falha ao publicar: credential_missing",
 * "Erro: validation_failed". Para um dono de negócio isso não diz nem o que deu
 * errado nem onde mexer. Cada frase aqui responde as duas coisas. O código vai
 * junto entre parênteses para quem dá suporte.
 *
 * As frases são CHAVES do dicionário de tradução (`lib/i18n/dicionario.ts`):
 * quem chama passa o resultado por `t()`.
 */
const MENSAGENS: Record<string, string> = {
  credential_missing:
    "Escolha a chave de acesso da empresa de inteligência artificial — ou cadastre uma em IA › Credenciais.",
  credential_not_found: "A chave de acesso escolhida não existe mais. Escolha outra em IA › Credenciais.",
  credential_inactive: "A chave de acesso escolhida está desativada. Ative-a ou escolha outra em IA › Credenciais.",
  credential_not_validated:
    "A chave de acesso ainda não foi validada. Abra IA › Credenciais e clique em validar.",
  credential_provider_mismatch:
    "A chave de acesso é de outra empresa de inteligência artificial. Escolha uma chave da mesma empresa do modelo.",
  channel_session_not_found: "O número de WhatsApp escolhido não existe mais. Escolha outro.",
  channel_session_offline:
    "O número de WhatsApp está desconectado. Reconecte-o em Conexões e tente publicar de novo.",
  model_not_found: "O modelo escolhido não está disponível. Escolha outro modelo.",
  tool_id_invalid: "Uma das capacidades marcadas não existe mais. Revise a lista de capacidades.",
  agent_archived: "Este agente está arquivado e não pode ser alterado.",
  agent_not_found: "Este agente não existe mais.",
  not_found: "Este agente não existe mais.",
  version_not_found: "Esta versão não existe mais. Recarregue a página.",
  version_invalid_state: "Esta versão já foi publicada. Recarregue a página para ver a mais recente.",
  validation_failed: "Há campos com valores que o servidor recusou. Confira os campos em vermelho.",
  forbidden_role: "Só quem é administrador pode salvar e publicar agentes.",
  forbidden_tenant: "Você não tem acesso a esta organização.",
  unauthenticated: "Sua sessão expirou. Entre de novo.",
  invalid_request: "O pedido não foi entendido. Recarregue a página e tente de novo.",
};

const PADRAO = "Algo deu errado do nosso lado. Tente de novo em instantes.";

/** A frase (chave do dicionário) para o código. Código desconhecido cai no texto genérico. */
export function mensagemDeErroDoAgente(codigo: string): string {
  return MENSAGENS[codigo] ?? PADRAO;
}

/** Todas as frases — para o teste conferir que cada uma tem tradução. */
export const FRASES_DE_ERRO_DO_AGENTE: readonly string[] = [...new Set([...Object.values(MENSAGENS), PADRAO])];
