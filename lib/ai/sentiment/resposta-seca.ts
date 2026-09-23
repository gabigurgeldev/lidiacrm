/**
 * "NÃO" É UMA RESPOSTA, NÃO É UM CLIENTE INSATISFEITO.
 *
 * ## O defeito que este arquivo existe para consertar
 *
 * Medido na instalação de produção em 2026-09-23, nos eventos `ai.sentiment_alert`
 * que escalaram conversa para humano nos últimos dias:
 *
 *   | mensagem do cliente | nota do classificador |
 *   |---------------------|-----------------------|
 *   | `Não`               | 0.15                  |
 *   | `não`               | 0.15                  |
 *   | `Vou não`           | 0.15                  |
 *
 * O limiar é 0.3, então as três dispararam handoff com motivo `low_sentiment`.
 * O handoff silencia o bot, joga a conversa na fila e — desde a onda do aviso ao
 * lead — MANDA UMA MENSAGEM ao cliente: "Vou pedir ajuda de alguém da equipe...
 * Não há atendente disponível neste instante — sua conversa entrou na fila."
 *
 * Ou seja: o cliente respondeu "não" a uma pergunta de sim/não e foi informado
 * de que entrou numa fila de atendimento que ele não pediu. Numa conta sem
 * atendente livre, ninguém aparece depois — a promessa fica aberta. Foi o que
 * os clientes do dono do produto reclamaram.
 *
 * ## Por que o modelo erra, e por que a culpa não é dele
 *
 * "Não" sozinho não CARREGA sentimento: não há do que extrair humor. O
 * classificador recebe um token cuja polaridade lexical é negativa, sem nada em
 * volta para contradizê-lo, e pontua no fundo da escala. Com mais contexto ele
 * acerta — o problema é pedir um juízo que a mensagem não permite.
 *
 * ## Por que uma lista fechada, e não "mensagem curta demais"
 *
 * Porque mensagem curta pode ser a mais grave de todas: "péssimo", "horrível",
 * "cancela tudo", "golpe". Uma regra de tamanho silenciaria justamente a
 * reclamação real — trocaria um falso positivo barulhento por um falso negativo
 * mudo, que é o pior dos dois num produto de atendimento.
 *
 * Então o corte é por VOCABULÁRIO: a mensagem inteira é uma resposta de
 * sim/não (com as variações que o brasileiro usa no WhatsApp) e mais nada. É a
 * mesma forma do detector de opt-out (`lib/opt-out/deteccao.ts`), que aprendeu
 * a lição equivalente: palavra isolada é sinal, palavra dentro de frase não é.
 *
 * ## O que este módulo NÃO decide
 *
 * Ele não diz que a conversa é neutra — diz que ESTA MENSAGEM não é evidência
 * de nada. Quem classifica continua sendo o modelo, para todo o resto. A outra
 * metade do conserto é o prompt (`lib/ai/prompts/sentiment.ts`), que passou a
 * separar "resposta negativa" de "insatisfação".
 */

import { normalizarTexto } from "@/lib/opt-out/deteccao";

/**
 * Respostas de sim/não que, ENVIADAS SOZINHAS, não carregam humor.
 *
 * Tudo em minúsculas e sem acento — a comparação normaliza antes (a mesma
 * `normalizarTexto` do opt-out, para não haver duas noções de "mesma palavra"
 * no produto).
 *
 * ⚠️ A lista só cresce com caso MEDIDO. Acrescentar por intuição é como a
 * detecção de opt-out bloqueou paciente que perguntou "tem como parar a dor?":
 * cada palavra a mais é uma mensagem a menos sendo avaliada, e o silêncio de um
 * falso negativo não aparece em métrica nenhuma.
 */
const RESPOSTAS_SECAS: ReadonlySet<string> = new Set([
  // Negativas
  "nao",
  "n",
  "nop",
  "nops",
  "nada",
  "negativo",
  "agora nao",
  "hoje nao",
  "ainda nao",
  "por enquanto nao",
  "vou nao",
  "quero nao",
  "posso nao",
  "consigo nao",
  "acho que nao",
  "nao sei",
  "nao obrigado",
  "nao obrigada",
  // Afirmativas — entram pelo mesmo motivo: também não carregam humor, e a
  // simetria evita que um dia alguém "conserte" só um lado.
  "sim",
  "s",
  "ss",
  "isso",
  "isso mesmo",
  "ok",
  "okay",
  "blz",
  "beleza",
  "certo",
  "claro",
  "pode ser",
  "aham",
  "uhum",
  "sei",
  "ta",
  "ta bom",
  "tudo bem",
  "combinado",
  "fechado",
  "perfeito",
  "show",
]);

/**
 * `true` quando a mensagem inteira é uma resposta de sim/não e nada mais.
 *
 * A pontuação e os emojis saem antes da comparação: "Não." e "não 👍" são a
 * mesma resposta, e deixá-los de fora da limpeza faria a guarda pegar uma
 * grafia e perder a vizinha — que é como uma lista destas morre em silêncio.
 */
export function ehRespostaSeca(texto: string | null | undefined): boolean {
  if (!texto) return false;

  const limpo = normalizarTexto(texto)
    // Fora tudo que não é letra, dígito ou espaço. `\p{L}`/`\p{N}` com a flag
    // `u` em vez de `[a-z0-9]`: sem isso, qualquer coisa fora do ASCII viraria
    // espaço e "não" já normalizado ("nao") sobreviveria por acaso, enquanto
    // uma grafia acentuada de outra palavra seria picotada.
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

  if (limpo === "") return false;
  return RESPOSTAS_SECAS.has(limpo);
}
