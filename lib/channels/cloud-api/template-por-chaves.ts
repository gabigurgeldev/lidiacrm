/**
 * `components[]` de um template a partir das CHAVES DE SLOT, sem o espelho.
 *
 * ─── Por que existe, se `buildComponents` já faz isso ───────────────────────
 *
 * `buildComponents` (lib/channels/meta) é melhor e continua sendo o caminho
 * preferido: ele parte do CONTRATO derivado da definição aprovada, então sabe se
 * um slot é texto, imagem ou cupom, e sabe que um carrossel tem dois cards.
 *
 * Ele precisa da definição espelhada em `meta_templates`. Há um caso em que ela
 * não está: a conexão cujo espelho o CRM não sincroniza — porque a plataforma
 * dela não expõe listagem de definições, ou porque ninguém sincronizou ainda.
 * Ali `conferirDefinicao` deixa passar de propósito ("recusar o que não se sabe
 * é pior que deixar o provedor responder — ele é a autoridade, não este
 * espelho"), e sem este montador o envio sairia SEM parâmetro nenhum: a
 * plataforma recusaria com 132000, e o operador leria um número.
 *
 * ─── O que dá para reconstruir das chaves, e o que não dá ───────────────────
 *
 * As chaves saem de `slotKey`, e o prefixo delas É o endereço: corpo sem
 * prefixo (`1`, `2`), cabeçalho com `header:`, botão com `buttonN:`. Então
 * corpo e cabeçalho de TEXTO — que é a esmagadora maioria — reconstroem
 * exatamente. O que não dá:
 *
 *   - **tipo de mídia**: `header:1` de uma definição com cabeçalho de imagem
 *     pede `{type:"image", image:{link}}`, e das chaves não há como saber. Aqui
 *     ele sai como texto, e a plataforma recusa — alto, não em silêncio.
 *   - **carrossel**: `card0:1` viraria um card, e montá-lo de palpite mandaria
 *     metade dele errado. Fica de fora, e o slot é ignorado.
 *
 * Ou seja: este montador cobre o caso comum e FALHA VISÍVEL no resto, em vez de
 * cobrir tudo mal. Quem quiser o resto sincroniza o espelho e cai no caminho bom.
 */

import type { MetaSendComponent, MetaSendParameter } from "../meta/build-components";

/** `1`, `2`, `10` — o corpo, que é o caso comum e não leva prefixo. */
const CHAVE_DE_CORPO = /^\d+$/u;
/** `header:1` — o cabeçalho. */
const CHAVE_DE_CABECALHO = /^header:(\d+)$/u;

function texto(valor: string): MetaSendParameter {
  return { type: "text", text: valor };
}

/**
 * Ordena pelo NÚMERO e não pelo texto da chave: alfabeticamente `10` vem antes
 * de `2`, e o cliente receberia os valores trocados de lugar — sem erro nenhum,
 * que é o pior desfecho possível numa mensagem que sai para fora.
 */
function porNumero(chaves: string[], extrair: (k: string) => string): string[] {
  return [...chaves].sort((a, b) => Number(extrair(a)) - Number(extrair(b)));
}

export function componentsPorChave(values: Record<string, string>): MetaSendComponent[] {
  const preenchidas = Object.keys(values).filter((k) => (values[k] ?? "").trim() !== "");

  const corpo = porNumero(
    preenchidas.filter((k) => CHAVE_DE_CORPO.test(k)),
    (k) => k,
  );
  const cabecalho = porNumero(
    preenchidas.filter((k) => CHAVE_DE_CABECALHO.test(k)),
    (k) => CHAVE_DE_CABECALHO.exec(k)![1]!,
  );

  const components: MetaSendComponent[] = [];
  // Cabeçalho antes do corpo, que é a ordem em que a Meta os documenta e a que
  // `buildComponents` produz — um payload com a ordem trocada é aceito, mas a
  // diferença apareceria em todo teste que compare os dois caminhos.
  if (cabecalho.length > 0) {
    components.push({ type: "header", parameters: cabecalho.map((k) => texto(values[k]!)) });
  }
  if (corpo.length > 0) {
    components.push({ type: "body", parameters: corpo.map((k) => texto(values[k]!)) });
  }
  return components;
}
