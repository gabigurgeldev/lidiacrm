/**
 * O que o Enter faz no campo de mensagem — depende do TECLADO, não da tela.
 *
 * No computador: Enter envia, Shift+Enter quebra linha (o atalho de sempre).
 * No celular o teclado virtual não tem Shift+Enter: com "Enter envia" não havia
 * NENHUMA forma de escrever uma mensagem com duas linhas — e cada toque na
 * tecla de quebra mandava meia frase ao cliente. Como no WhatsApp, no toque o
 * Enter quebra linha e quem envia é o botão redondo.
 *
 * "Toque" é `pointer: coarse` (o dedo como ponteiro principal), e não a
 * largura da tela: um laptop com a janela estreita continua tendo teclado
 * físico, e um tablet largo continua sem ele.
 */
export function enterEnvia(e: { key: string; shiftKey: boolean }, toque: boolean): boolean {
  if (e.key !== "Enter" || e.shiftKey) return false;
  return !toque;
}

/** Lido na hora do evento: não há hidratação a respeitar, e o jsdom não tem `matchMedia`. */
export function ponteiroDeToque(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(pointer: coarse)").matches;
}
