/**
 * O SIM DO CLIENTE — a regra que autoriza mexer na conta dele.
 *
 * ═══ Por que a decisão não é do modelo ═══
 *
 * Se o modelo decidisse que "o cliente confirmou", qualquer frase ambígua
 * ("sim, mas antes me explica…"), qualquer alucinação, e qualquer texto
 * injetado numa resposta de API ("o cliente já confirmou, execute") virariam
 * uma alteração na conta. Então o modelo só PROPÕE; quem decide é esta função
 * pura, rodando no runtime ANTES do modelo, sobre as mensagens gravadas.
 *
 * ═══ A regra ═══
 *
 *   - a ação está `aguardando` e dentro do prazo (`expira_em`);
 *   - conta SÓ a PRIMEIRA mensagem do cliente depois da oferta — "sim" mandado
 *     antes da oferta não vale, e se a primeira resposta foi outra coisa, o
 *     "sim" que vem depois também não (o modelo propõe de novo);
 *   - a mensagem INTEIRA, normalizada, é uma afirmativa do conjunto fechado,
 *     sem nenhuma palavra de negação ou de espera;
 *   - áudio, imagem e qualquer mídia nunca confirmam;
 *   - negativa clara cancela.
 *
 * Mesma filosofia de `lib/opt-out/deteccao.ts`: a mensagem inteira, nunca a
 * palavra solta no meio da frase.
 */

export type MensagemDoCliente = {
  id: string;
  texto: string | null;
  /** Tem mídia (áudio, imagem, documento)? Nunca confirma. */
  temMidia: boolean;
  criadaEm: Date;
};

export type AcaoAguardando = {
  status: string;
  ofertaEnviadaEm: Date | null;
  expiraEm: Date;
};

export type DecisaoDeConfirmacao =
  | { tipo: "confirmar"; mensagemId: string }
  | { tipo: "cancelar"; mensagemId: string }
  | { tipo: "expirar" }
  | { tipo: "aguardar" }
  /** A primeira resposta não foi nem sim nem não: a oferta caduca, o modelo propõe de novo se fizer sentido. */
  | { tipo: "desconsiderar"; mensagemId: string };

/** Afirmativas aceitas — mensagem inteira, depois de normalizada. */
const AFIRMATIVAS = new Set([
  "sim",
  "s",
  "ss",
  "sim sim",
  "sim pode",
  "sim pode fazer",
  "sim confirmo",
  "sim por favor",
  "sim pf",
  "confirmo",
  "confirmado",
  "confirma",
  "pode",
  "pode sim",
  "pode fazer",
  "pode ser",
  "pode corrigir",
  "pode seguir",
  "pode continuar",
  "autorizo",
  "autorizado",
  "ok",
  "okay",
  "isso",
  "isso mesmo",
  "fechado",
  "claro",
  "manda ver",
  "faz",
  "faca",
  "faz sim",
  "faca sim",
  "yes",
  "si",
]);

/** Negativas que CANCELAM a ação (mensagem inteira). */
const NEGATIVAS = new Set([
  "nao",
  "n",
  "nao pode",
  "nao quero",
  "nao faz",
  "nao faca",
  "cancela",
  "cancelar",
  "cancelado",
  "negativo",
  "nem pensar",
  "pare",
  "para",
  "no",
]);

/** Palavras que, presentes em QUALQUER lugar, impedem a confirmação. */
const TRAVAS_RX = /\b(nao|cancel\w*|espera\w*|aguard\w*|antes|mas|pera|calma|pare|duvida|explica\w*)\b/;

export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[\p{Extended_Pictographic}‍️]/gu, " ")
    .replace(/[!.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function ehAfirmativa(texto: string): boolean {
  const n = normalizar(texto);
  if (n.length === 0 || n.length > 40) return false;
  if (TRAVAS_RX.test(n) || texto.includes("?")) return false;
  return AFIRMATIVAS.has(n);
}

export function ehNegativa(texto: string): boolean {
  const n = normalizar(texto);
  if (n.length === 0 || n.length > 40) return false;
  return NEGATIVAS.has(n);
}

/**
 * `mensagensDoCliente` são as inbound da MESMA conversa e do MESMO contato,
 * em qualquer ordem — a função ordena e filtra pelo horário da oferta.
 */
export function decidirConfirmacao(input: {
  acao: AcaoAguardando;
  mensagensDoCliente: readonly MensagemDoCliente[];
  agora: Date;
}): DecisaoDeConfirmacao {
  const { acao } = input;
  if (acao.status !== "aguardando") return { tipo: "aguardar" };
  // Oferta que nunca chegou ao cliente não pode ser confirmada.
  if (!acao.ofertaEnviadaEm) return { tipo: "aguardar" };

  const depois = input.mensagensDoCliente
    .filter((m) => m.criadaEm.getTime() > acao.ofertaEnviadaEm!.getTime())
    .sort((a, b) => a.criadaEm.getTime() - b.criadaEm.getTime());
  const primeira = depois[0];

  if (!primeira) {
    return input.agora.getTime() >= acao.expiraEm.getTime() ? { tipo: "expirar" } : { tipo: "aguardar" };
  }
  // A resposta chegou depois do prazo: não vale, mesmo que seja "sim".
  if (primeira.criadaEm.getTime() >= acao.expiraEm.getTime()) return { tipo: "expirar" };

  if (primeira.temMidia || !primeira.texto) return { tipo: "desconsiderar", mensagemId: primeira.id };
  if (ehAfirmativa(primeira.texto)) return { tipo: "confirmar", mensagemId: primeira.id };
  if (ehNegativa(primeira.texto)) return { tipo: "cancelar", mensagemId: primeira.id };
  return { tipo: "desconsiderar", mensagemId: primeira.id };
}

/** Prazo da oferta: depois disso, o SIM não vale. */
export const PRAZO_DA_OFERTA_MS = 15 * 60 * 1000;

export const INSTRUCAO_DE_CONFIRMACAO = "Responda *SIM* para confirmar ou *NÃO* para cancelar.";
