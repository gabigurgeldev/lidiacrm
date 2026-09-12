/**
 * QR OU TEMPLATE OFICIAL? A PERGUNTA É UMA SÓ, E QUEM RESPONDE É A CONEXÃO.
 *
 * ═══ Por que a tela NÃO pergunta duas vezes ═══
 *
 * O pedido do produto foi "escolhe se quer pelo WhatsApp QR code ou pelo
 * template de API oficial". Lido como duas perguntas — canal, e depois modo —
 * ele produz duas combinações que não existem:
 *
 *   * QR + template: não há WABA por trás, então não existe definição aprovada
 *     para escolher (`canManageTemplates: false`) e o adapter não tem
 *     `sendTemplate`.
 *   * oficial + texto livre: a API aceita (200 + wamid) e a Meta recusa a
 *     ENTREGA depois, pelo webhook, com `131047`. Medido e escrito em
 *     `lib/channels/capabilities.ts` — quem lê o 200 como "enviado" acha que
 *     funciona.
 *
 * A pessoa escolhe uma CONEXÃO; o modo é consequência dela. É literalmente o
 * invariante 1 de `docs/doctrine/restricao-de-canal.md`: feature nenhuma
 * pergunta *com quem* falamos — pergunta *o que o canal permite*.
 *
 * ═══ Zero literal de provider ═══
 *
 * Nada aqui compara o provider com uma string literal. A decisão sai de
 * `capabilitiesOf()`,
 * que é o único lugar do sistema autorizado a conhecer a diferença entre canais
 * (`scripts/lint-channels.ts` reprova o contrário). Um canal novo que exija
 * template passa a exigir template aqui sem ninguém editar este arquivo.
 */
import {
  capabilitiesOf,
  capabilitiesOfSession,
  type ChannelProvider,
} from "@/lib/channels/capabilities";

export type ModoDeDisparo = "freeform" | "template";

/**
 * A conexão, como o banco a guarda. `mode` é `channel_sessions.provider_mode`,
 * nullable por desenho (migration 0206): `null` afirma "este provider tem
 * modalidade única, pergunte a ele".
 */
export interface ConexaoParaModo {
  provider: ChannelProvider;
  mode?: string | null;
}

/**
 * O único modo que esta CONEXÃO aceita para uma campanha.
 *
 * ⚠️ Recebe a conexão, e não o provider, desde que um provider passou a hospedar
 * as duas modalidades. Com `capabilitiesOf(provider)` a linha que respondia era
 * a conservadora de fallback — `requiresTemplates: true` —, e o resultado
 * aparecia na tela: um número ligado por QR naquela conta era anunciado como
 * "Só envia modelo aprovado", e o texto livre que ele aceita ficava barrado.
 */
export function modoPermitidoNaConexao(conexao: ConexaoParaModo): ModoDeDisparo {
  return capabilitiesOfSession(conexao).requiresTemplates ? "template" : "freeform";
}

/**
 * A mesma pergunta para quem só tem o provider em mãos — uma decisão sobre o
 * canal em abstrato, antes de haver conexão escolhida. Prefira a de cima sempre
 * que houver uma linha de `channel_sessions`.
 */
export function modoPermitido(provider: ChannelProvider): ModoDeDisparo {
  return capabilitiesOf(provider).requiresTemplates ? "template" : "freeform";
}

/**
 * `null` = a combinação é válida. Caso contrário, a frase que a borda devolve e
 * a tela mostra — em pt-BR, dizendo o que fazer, não só o que está errado.
 */
export function recusaDeModo(
  conexao: ChannelProvider | ConexaoParaModo,
  modo: ModoDeDisparo,
): string | null {
  const permitido =
    typeof conexao === "string" ? modoPermitido(conexao) : modoPermitidoNaConexao(conexao);
  if (modo === permitido) return null;

  return permitido === "template"
    ? "Esta conexão é o canal oficial do WhatsApp: fora da janela de 24 horas ela só entrega modelo aprovado. " +
        "Escolha um modelo em Conexões › Modelos, ou use uma conexão por QR code para enviar texto livre."
    : "Esta conexão é um número por QR code: ela não tem modelos aprovados para escolher. " +
        "Escreva o texto da mensagem, ou use uma conexão do canal oficial para disparar por modelo.";
}

/**
 * O canal cobra por mensagem? A tela de confirmação precisa avisar ANTES de o
 * operador apertar o botão — 500 mensagens no canal oficial têm fatura, e
 * descobrir isso depois é o pior momento.
 */
export function temCustoPorMensagem(provider: ChannelProvider): boolean {
  return capabilitiesOf(provider).costPerMessage;
}

/**
 * O canal corre risco de BANIMENTO por volume? Decide se a tela mostra o teto
 * de warm-up de hoje e o aviso de ritmo — e, no motor, se `decidePacing` arma
 * as guardas anti-ban (`banRisk`).
 */
export function temRiscoDeBanimento(provider: ChannelProvider): boolean {
  return capabilitiesOf(provider).banRisk;
}
