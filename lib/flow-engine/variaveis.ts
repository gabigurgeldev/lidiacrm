/**
 * Flow Engine — interpolação de `{{caminho}}`. Puro, sem I/O.
 *
 * Substituição de caminho, e NÃO uma linguagem: `{{lead.title}}` resolve,
 * `{{ lead.value * 0.1 }}` não. O porquê está no cabeçalho de `condicoes.ts` —
 * um interpretador é superfície de ataque que esta entrega não precisa abrir.
 *
 * ⚠️ O texto substituído NÃO é reescaneado. Se o nome de um contato for
 * literalmente `{{vars.segredo}}`, ele sai como esses caracteres e não vira
 * uma segunda resolução — expansão recursiva sobre dado que veio de fora é
 * injeção de gabarito, e o dado aqui vem de mensagem de WhatsApp.
 */

/** Teto do texto final. Corpo de mensagem no repo já é limitado a 4000. */
const LIMITE_DO_TEXTO = 8000;

/**
 * Um caminho: letras, números, underscore, separados por ponto. Deliberadamente
 * estreito — `{{...}}` com qualquer outra coisa dentro é deixado intacto, para
 * um texto que use chaves por outro motivo não ser mutilado.
 */
const MARCADOR = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*\}\}/gu;

function textoDe(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "string") return valor;
  if (typeof valor === "number" || typeof valor === "boolean") return String(valor);
  if (Array.isArray(valor)) return valor.map(textoDe).filter((s) => s !== "").join(", ");
  if (valor instanceof Date) return valor.toISOString();
  return JSON.stringify(valor);
}

function resolver(escopo: unknown, caminho: string): { presente: boolean; valor: unknown } {
  let atual: unknown = escopo;
  for (const parte of caminho.split(".")) {
    if (atual === null || atual === undefined || typeof atual !== "object") {
      return { presente: false, valor: undefined };
    }
    if (!(parte in (atual as Record<string, unknown>))) {
      return { presente: false, valor: undefined };
    }
    atual = (atual as Record<string, unknown>)[parte];
  }
  return { presente: true, valor: atual };
}

export interface Interpolacao {
  texto: string;
  /**
   * Caminhos que o texto pediu e o escopo não tinha. Devolvidos em vez de
   * engolidos: quem publica um fluxo precisa poder ser avisado de que a
   * mensagem vai sair com um buraco, e quem executa precisa poder registrar
   * isso no passo — um `{{lead.name}}` vazio numa mensagem ao cliente é um
   * defeito visível que hoje ninguém veria.
   */
  ausentes: string[];
}

export function interpolar(texto: string, escopo: unknown): Interpolacao {
  const ausentes: string[] = [];
  const saida = texto.replace(MARCADOR, (inteiro, caminho: string) => {
    const { presente, valor } = resolver(escopo, caminho);
    if (!presente) {
      ausentes.push(caminho);
      // Marcador ausente vira VAZIO, e não o literal `{{lead.name}}`. Mandar a
      // chave crua numa mensagem de WhatsApp para o cliente é pior que a
      // lacuna — e a lacuna fica registrada em `ausentes`.
      return "";
    }
    if (valor === null || valor === undefined) {
      ausentes.push(caminho);
      return "";
    }
    return textoDe(valor);
  });
  return { texto: saida.slice(0, LIMITE_DO_TEXTO), ausentes: [...new Set(ausentes)] };
}

/** Só o texto — para os nós, que não decidem o que fazer com a lacuna. */
export function render(texto: string, escopo: unknown): string {
  return interpolar(texto, escopo).texto;
}

/** Todos os caminhos que um texto referencia. A tela usa para pré-validar. */
export function caminhosCitados(texto: string): string[] {
  const achados = [...texto.matchAll(MARCADOR)].map((m) => m[1] as string);
  return [...new Set(achados)];
}
