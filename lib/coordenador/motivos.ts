/**
 * Os motivos de transição — vocabulário FECHADO, com o rótulo que a tela mostra.
 *
 * `coord_transicoes.motivo` grava o código; texto livre do modelo nunca vai
 * para a coluna (pode carregar dado do cliente, e não serve para filtrar).
 * Client-safe.
 */
export const MOTIVOS = {
  // entrada e continuidade
  primeira_mensagem_regra: "Primeira mensagem casou com uma regra",
  primeira_mensagem_modelo: "Primeira mensagem: o modelo escolheu o destino",
  primeira_mensagem_padrao: "Primeira mensagem: destino padrão",
  continua_responsavel: "Continua com quem já conduzia",
  resposta_a_pergunta: "Resposta à pergunta aberta",
  mudanca_de_assunto: "Mudança de assunto",
  interrupcao: "Cliente interrompeu a etapa",
  // pedidos dos executores
  agente_chamou_fluxo: "Agente chamou um fluxo (com retorno)",
  agente_transferiu: "Agente transferiu o atendimento",
  fluxo_chamou_agente: "Fluxo chamou um agente (com retorno)",
  fluxo_transferiu: "Fluxo transferiu o atendimento",
  retorno_da_chamada: "Tarefa concluída, voltou para quem chamou",
  chamada_cancelada: "Tarefa cancelada, voltou para quem chamou",
  chamada_expirou: "Tarefa venceu o prazo, voltou para quem chamou",
  // pessoas
  pessoa_assumiu: "Uma pessoa da equipe assumiu",
  contato_com_pessoa: "Contato marcado para atendimento humano",
  contato_bloqueado: "Contato bloqueado (pediu para parar)",
  devolvido_a_ia: "Equipe devolveu ao atendimento automático",
  ativacao_manual: "Fluxo ativado pela equipe",
  // falhas e proteção
  decisor_falhou: "O modelo de decisão falhou; seguiu a regra de segurança",
  destino_inelegivel: "Destino indisponível (não publicado ou desativado)",
  transferencias_demais: "Limite de transferências atingido",
  ciclo_detectado: "Laço de transferências contido",
  profundidade_excedida: "Chamadas aninhadas demais",
  sem_destino_seguro: "Sem destino automático seguro; ficou com a equipe",
  reconciliacao: "Estado anterior adotado ao ligar o coordenador",
  recuperacao: "Recuperado pelo vigia",
} as const;

export type Motivo = keyof typeof MOTIVOS;

export function rotuloDoMotivo(codigo: string): string {
  return (MOTIVOS as Record<string, string>)[codigo] ?? codigo;
}
