/**
 * O QUE A TELA DIZ SOBRE QUEM NÃO RECEBEU — e o que o operador faz a respeito.
 *
 * ═══ Por que cada motivo carrega um PRÓXIMO PASSO ═══
 *
 * Invariante 4 do sistema vivo: nenhuma demanda sem próximo passo. Uma lista de
 * 88 pessoas que não receberam, sem dizer o que fazer com cada uma, é um número
 * que assusta e não resolve. Cada motivo aqui responde três coisas: o que
 * aconteceu, se tem conserto, e onde se conserta.
 *
 * ═══ Por que `tentarDeNovo` é dado, e não decisão da tela ═══
 *
 * Porque a resposta é diferente por motivo e a diferença é de CONFORMIDADE, não
 * de conveniência. Oferecer "reenviar" para quem pediu para parar seria o
 * produto ajudando a violar o opt-out — e um botão a mais numa tela é fácil de
 * acrescentar por engano. Aqui a proibição é do dado.
 *
 * ═══ Divisão de trabalho com `lib/channels/frases-de-falha.ts` ═══
 *
 * Aquele arquivo traduz código de FALHA DE CANAL vindo do transporte, que
 * carrega nome de provider e por isso mora em `lib/channels/` por força da
 * doutrina de restrição de canal (invariante 1). Este traduz o
 * vocabulário de PULO, que é nosso e não sabe nada de canal. A tela de
 * resultado usa os dois: `fraseDoPulo` para `status='skipped'`,
 * `fraseDaFalhaDeCanal` para `status='failed'`.
 */
import type { MotivoDeBloqueio } from "@/lib/automation/guarda-do-contato";

/**
 * Os motivos que chegam a virar linha. É `MotivoDeBloqueio` menos `no_contact`
 * — sem contato não há linha, porque a FK exige. Espelha
 * `bulk_send_recipients_skip_reason_check` no banco, e há um teste que varre o
 * CHECK cobrando frase para cada valor.
 */
export type MotivoDoPulo = Exclude<MotivoDeBloqueio, "no_contact">;

export interface DesfechoDoPulo {
  /** Uma linha, em pt-BR, para quem não é técnico. */
  frase: string;
  /** O que fazer. `null` quando não há o que fazer — e dizer isso é o passo. */
  proximoPasso: string;
  /**
   * A tela pode oferecer reenvio para este motivo?
   *
   * `false` em bloqueio e recusa NÃO é limitação técnica: é o produto se
   * recusando a ajudar a furar um opt-out registrado.
   */
  tentarDeNovo: boolean;
  /** A tela leva ao contato? (todos levam hoje; o campo existe para não presumir) */
  abrirContato: boolean;
}

const PULOS: Record<MotivoDoPulo, DesfechoDoPulo> = {
  contact_blocked: {
    frase: "Esta pessoa pediu para não receber mais mensagens.",
    proximoPasso: "Não há o que fazer — e não deve haver. O pedido dela vale para todo disparo futuro.",
    tentarDeNovo: false,
    abrirContato: true,
  },
  consent_declined: {
    frase: "Esta pessoa recusou receber comunicação de marketing.",
    proximoPasso: "Não há o que fazer. A recusa fica registrada no contato e vale para todo disparo futuro.",
    tentarDeNovo: false,
    abrirContato: true,
  },
  no_phone: {
    frase: "Este contato não tem telefone cadastrado.",
    proximoPasso: "Abra o contato e adicione o telefone. Depois ele pode entrar num disparo novo.",
    tentarDeNovo: false,
    abrirContato: true,
  },
  contact_anonymized: {
    frase: "Este contato foi anonimizado a pedido do titular (LGPD).",
    proximoPasso: "Não há o que fazer, e a anonimização não se desfaz.",
    tentarDeNovo: false,
    abrirContato: false,
  },
  contact_merged: {
    frase: "Este contato foi mesclado com outro e não é mais o registro válido.",
    proximoPasso: "Quem responde agora é o contato que o absorveu — inclua ele num disparo novo.",
    tentarDeNovo: false,
    abrirContato: true,
  },
};

/**
 * `null` para motivo desconhecido — e o chamador mostra o código cru. Falha
 * ABERTA de propósito: inventar frase para valor que não conhecemos esconderia
 * um vocabulário que divergiu, e é o teste de varredura que existe para essa
 * divergência nunca chegar à tela.
 */
export function fraseDoPulo(motivo: string | null | undefined): DesfechoDoPulo | null {
  if (!motivo) return null;
  return PULOS[motivo as MotivoDoPulo] ?? null;
}

/** Todos os motivos conhecidos — o teste de varredura compara com o CHECK. */
export function motivosDePuloConhecidos(): MotivoDoPulo[] {
  return Object.keys(PULOS) as MotivoDoPulo[];
}

// ---------------------------------------------------------------------------
// A pausa do disparo
// ---------------------------------------------------------------------------

/**
 * Por que a campanha parou. Os três primeiros são os códigos de veto que
 * `decidePacing()` devolve — copiados aqui só como TIPO; a frase instrutiva
 * completa (com hora e fuso) vem do próprio motor em `pause_detail`, e a tela
 * mostra as duas: este título curto, e o detalhe verbatim dele.
 */
export type MotivoDaPausa = "outside_window" | "warmup_cap" | "daily_cap" | "operador";

export interface DesfechoDaPausa {
  titulo: string;
  proximoPasso: string;
  /** A tela oferece link para Conexões, onde os knobs se mudam? */
  abrirConexoes: boolean;
}

const PAUSAS: Record<MotivoDaPausa, DesfechoDaPausa> = {
  outside_window: {
    titulo: "Esperando a janela de envio abrir",
    proximoPasso:
      "O disparo continua sozinho no horário. Para mudar a janela deste número, vá em Conexões.",
    abrirConexoes: true,
  },
  warmup_cap: {
    titulo: "Limite de aquecimento do número atingido hoje",
    proximoPasso:
      "Número novo manda pouco por dia de propósito, para não ser banido. O disparo continua amanhã, sozinho.",
    abrirConexoes: true,
  },
  daily_cap: {
    titulo: "Limite diário do número atingido",
    proximoPasso: "O disparo continua amanhã, sozinho. O limite deste número se ajusta em Conexões.",
    abrirConexoes: true,
  },
  operador: {
    titulo: "Pausado por você",
    proximoPasso: "Continue quando quiser — o disparo retoma de onde parou, sem repetir ninguém.",
    abrirConexoes: false,
  },
};

export function fraseDaPausa(motivo: string | null | undefined): DesfechoDaPausa | null {
  if (!motivo) return null;
  return PAUSAS[motivo as MotivoDaPausa] ?? null;
}

export function motivosDePausaConhecidos(): MotivoDaPausa[] {
  return Object.keys(PAUSAS) as MotivoDaPausa[];
}
