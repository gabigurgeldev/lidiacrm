/**
 * Motivos de passagem para humano que o SISTEMA grava — e como a tela os lê.
 *
 * `conversations.last_handoff_reason` é vocabulário ABERTO (o atendente escreve
 * texto livre ao escalar; o modelo também, no `reason` da ferramenta), por isso
 * não há CHECK no banco. O que este arquivo fecha é o lado de quem EMITE: motivo
 * de sistema sai daqui como constante, nunca como string solta, para a contagem
 * por motivo (painel de resultado, Central) não se partir em grafias.
 *
 * Módulo puro e sem import: é lido pelo motor (`pg`) e pelo CRM (rota Next).
 */

/** O cliente pediu uma pessoa. */
export const MOTIVO_PEDIU_HUMANO = "requested_human";
/** Suspeita de pedido de parada. */
export const MOTIVO_SUSPEITA_DE_OPT_OUT = "suspected_optout";
/** O teto de gasto com IA parou o atendimento automático. */
export const MOTIVO_ORCAMENTO_DE_IA = "orcamento_de_ia";
/** O cliente mandou foto e o agente passa nesses casos (migration 0243). */
export const MOTIVO_FOTO_DO_CLIENTE = "customer_image";
/** Faltou informação no material do agente (Onda 1). */
export const MOTIVO_FORA_DA_BASE = "fora_da_base";

const ROTULOS: Readonly<Record<string, string>> = {
  [MOTIVO_PEDIU_HUMANO]: "O cliente pediu para falar com uma pessoa",
  [MOTIVO_SUSPEITA_DE_OPT_OUT]: "O cliente pode ter pedido para parar de receber mensagens",
  [MOTIVO_ORCAMENTO_DE_IA]: "O limite de gasto com IA foi atingido",
  [MOTIVO_FOTO_DO_CLIENTE]: "O cliente mandou uma foto",
  [MOTIVO_FORA_DA_BASE]: "Faltou informação no material do agente",
};

/**
 * A frase que a tela mostra. Motivo desconhecido (texto livre de quem escalou)
 * volta como veio — é a explicação que a pessoa escreveu, e trocá-la por um
 * rótulo genérico apagaria a informação.
 */
export function rotuloDoMotivo(reason: string): string {
  return ROTULOS[reason] ?? reason;
}
