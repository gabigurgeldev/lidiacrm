/**
 * "Só responder sobre…" em palavras, para quem nunca viu uma expressão regular.
 *
 * O banco guarda um padrão (`trigger_config.filters.keyword_regex`), e é ele que
 * o motor lê (`lib/agent-engine/agent/filtro-de-assunto.ts`). A tela mostra uma
 * lista de palavras separadas por vírgula e converte nos dois sentidos. Um
 * padrão que não é só uma lista de palavras (tem `\b`, `.*`, grupos…) não vira
 * palavras: a tela abre no modo avançado, sem reescrever o que foi salvo.
 */

const ESPECIAIS = /[.*+?^${}()|[\]\\/]/g;

function escapar(palavra: string): string {
  return palavra.replace(ESPECIAIS, "\\$&");
}

/** "pedido, segunda via" → `pedido|segunda via`. Nenhuma palavra → `null` (sem filtro). */
export function palavrasParaPadrao(texto: string): string | null {
  const vistas = new Set<string>();
  const palavras: string[] = [];
  for (const bruta of texto.split(",")) {
    const p = bruta.trim().replace(/\s+/g, " ");
    if (p === "" || vistas.has(p.toLowerCase())) continue;
    vistas.add(p.toLowerCase());
    palavras.push(escapar(p));
  }
  return palavras.length === 0 ? null : palavras.join("|");
}

/**
 * O caminho de volta. `[]` para padrão vazio; `null` quando o padrão usa algo
 * além de palavras separadas por `|` (e então só o modo avançado o mostra).
 */
export function padraoParaPalavras(padrao: string | null): string[] | null {
  if (padrao === null || padrao.trim() === "") return [];
  let corpo = padrao;
  const grupo = /^\(\?:(.*)\)$/.exec(corpo);
  if (grupo) corpo = grupo[1]!;

  const palavras: string[] = [];
  let atual = "";
  for (let i = 0; i < corpo.length; i++) {
    const c = corpo[i]!;
    if (c === "\\") {
      const prox = corpo[i + 1];
      // Só o escape de caractere especial é "letra literal"; `\b`, `\d`, `\s`… não.
      if (prox === undefined || !/[.*+?^${}()|[\]\\/]/.test(prox)) return null;
      atual += prox;
      i++;
      continue;
    }
    if (c === "|") {
      palavras.push(atual);
      atual = "";
      continue;
    }
    if (/[.*+?^${}()[\]]/.test(c)) return null;
    atual += c;
  }
  palavras.push(atual);
  const limpas = palavras.map((p) => p.trim());
  // Uma alternativa vazia (`a||b`) casaria com qualquer mensagem: não é lista.
  if (limpas.some((p) => p === "" || p.includes(","))) return null;
  return limpas;
}
