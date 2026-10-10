/**
 * "Escolha uma opção" — o formato NEUTRO e a decisão de como ele sai.
 *
 * Quem oferece opções (o menu do fluxo, o agente, a pessoa no inbox) não sabe
 * nem deve saber o que o canal desenha: é a mesma regra do invariante 1 de
 * `docs/doctrine/restricao-de-canal.md`. Ela pede um formato; esta função
 * responde o que de fato sai, a partir da capability da SESSÃO:
 *
 *   enquete → lista → texto numerado   (pedido "enquete" ou "automatico")
 *   lista   → enquete → texto numerado (pedido "lista")
 *
 * Texto numerado é o piso porque TODO canal entrega texto — rebaixar nunca é
 * falha de envio, é a mesma pergunta num formato que a pessoa responde
 * digitando o número. E o casamento da resposta aceita as duas coisas (o toque
 * devolve o rótulo; quem digita manda o número), então o fluxo segue igual.
 *
 * Mora em `lib/channels/` porque decide a partir de capability; não nomeia
 * provider nenhum.
 */
import type { OpcaoInterativa, OpcoesInterativas, TipoComOpcoes } from "@/lib/schemas";

import type { ChannelCapabilities } from "./types";

export type FormatoPedido = "enquete" | "lista" | "automatico";
export type FormatoDecidido = "enquete" | "lista" | "texto";

/** Abaixo disso não é escolha — e a enquete com uma opção a plataforma recusa. */
export const MINIMO_DE_OPCOES = 2;
/** O teto da lista interativa, o menor dos dois formatos. */
export const MAXIMO_DE_OPCOES = 10;

/**
 * O formato que de fato sai.
 *
 * `grupo`: a lista só é entregue em conversa 1:1 (o transporte do QR a recusa
 * em grupo), então em grupo ela nunca é escolhida — nem como segunda opção.
 */
export function formatoDasOpcoes(
  caps: Pick<ChannelCapabilities, "opcoesInterativas">,
  pedido: FormatoPedido,
  contexto: { grupo: boolean; quantidade: number },
): FormatoDecidido {
  if (contexto.quantidade < MINIMO_DE_OPCOES || contexto.quantidade > MAXIMO_DE_OPCOES) {
    return "texto";
  }
  const pode = {
    enquete: caps.opcoesInterativas.enquete,
    lista: caps.opcoesInterativas.lista && !contexto.grupo,
  };
  const ordem: readonly ("enquete" | "lista")[] =
    pedido === "lista" ? ["lista", "enquete"] : ["enquete", "lista"];
  return ordem.find((f) => pode[f]) ?? "texto";
}

/** O tipo de mensagem (`messages.type`) de cada formato interativo. */
export function tipoDoFormato(formato: "enquete" | "lista"): TipoComOpcoes {
  return formato === "enquete" ? "poll" : "list";
}

export function formatoDoTipo(tipo: TipoComOpcoes): "enquete" | "lista" {
  return tipo === "poll" ? "enquete" : "lista";
}

const EMOJI_DO_NUMERO = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

/** "1️⃣ Suporte" / "2️⃣ Financeiro", uma por linha. */
export function listaNumerada(rotulos: readonly string[]): string {
  return rotulos.map((r, i) => `${EMOJI_DO_NUMERO[i] ?? `${i + 1}.`} ${r}`).join("\n");
}

/**
 * A pergunta com as opções numeradas embaixo.
 *
 * É o corpo do rebaixamento para texto — e TAMBÉM o `body` gravado na linha de
 * uma enquete/lista: é o que a prévia da conversa, a busca e a cascata da LGPD
 * enxergam, e é o que os gates de envio (repetição, vocabulário interno)
 * julgam. Uma enquete com corpo vazio passaria por eles sem ser lida.
 */
export function textoDasOpcoes(o: Pick<OpcoesInterativas, "pergunta" | "opcoes">): string {
  return `${o.pergunta.trim()}\n\n${listaNumerada(o.opcoes.map((x) => x.label))}`;
}

/**
 * Corta para caber num limite da plataforma, com reticências. Corta por
 * caractere visível (code point), não por unidade UTF-16: cortar no meio de um
 * emoji deixaria um caractere quebrado no aparelho do cliente.
 */
export function cortar(texto: string, max: number): string {
  const chars = Array.from(texto.trim());
  if (chars.length <= max) return chars.join("");
  return `${chars.slice(0, Math.max(0, max - 1)).join("").trimEnd()}…`;
}

/**
 * Uma linha de lista: título curto e, quando o rótulo não coube, o rótulo
 * inteiro na descrição — a pessoa lê tudo, e a seleção volta pelo `id`, que
 * não depende do corte.
 */
export function linhaDeLista(
  opcao: OpcaoInterativa,
  limites: { titulo: number; descricao: number },
): { id: string; titulo: string; descricao: string | null } {
  const titulo = cortar(opcao.label, limites.titulo);
  return {
    id: opcao.id,
    titulo,
    descricao: titulo === opcao.label.trim() ? null : cortar(opcao.label, limites.descricao),
  };
}

/** Texto padrão do botão que abre a lista, quando quem pediu não deu um. */
export const BOTAO_PADRAO_DA_LISTA = "Ver opções";

/** Sem acento e sem caixa — a mesma regra do menu do fluxo. */
export function normalizarRotulo(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .trim();
}

/**
 * Qual opção a resposta escolheu.
 *
 * O id vem primeiro: a lista devolve o `rowId`, que é o nosso id, e é imune a
 * rótulo cortado. O rótulo é o segundo caminho: a enquete devolve o TEXTO da
 * opção votada, e o canal pode tê-lo recebido cortado — por isso também casa
 * pelo começo, desde que só UMA opção comece assim.
 */
export function opcaoEscolhida(
  opcoes: readonly OpcaoInterativa[],
  resposta: { id?: string | null; rotulo?: string | null },
): OpcaoInterativa | null {
  if (resposta.id) {
    const porId = opcoes.find((o) => o.id === resposta.id);
    if (porId) return porId;
  }
  const alvo = normalizarRotulo(resposta.rotulo ?? "");
  if (alvo === "") return null;
  const exata = opcoes.find((o) => normalizarRotulo(o.label) === alvo);
  if (exata) return exata;
  const pelaFrente = opcoes.filter((o) => normalizarRotulo(o.label).startsWith(alvo));
  return pelaFrente.length === 1 ? (pelaFrente[0] ?? null) : null;
}

/**
 * O que a linha da mensagem de saída guarda em `metadata.opcoes` — a fonte de
 * verdade para traduzir o voto/seleção de volta no rótulo completo.
 */
export interface OpcoesGravadas extends OpcoesInterativas {
  formato: "enquete" | "lista";
}

/** Lê `metadata.opcoes` de uma linha, tolerando o que não for nosso. */
export function opcoesDaMetadata(metadata: unknown): OpcoesGravadas | null {
  if (metadata === null || typeof metadata !== "object") return null;
  const bruto = (metadata as Record<string, unknown>).opcoes;
  if (bruto === null || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;
  if (o.formato !== "enquete" && o.formato !== "lista") return null;
  if (typeof o.pergunta !== "string" || !Array.isArray(o.opcoes)) return null;
  const opcoes = o.opcoes.filter(
    (x): x is OpcaoInterativa =>
      x !== null &&
      typeof x === "object" &&
      typeof (x as Record<string, unknown>).id === "string" &&
      typeof (x as Record<string, unknown>).label === "string",
  );
  return {
    formato: o.formato,
    pergunta: o.pergunta,
    opcoes,
    ...(typeof o.botao === "string" ? { botao: o.botao } : {}),
  };
}

/**
 * O que a mensagem de RESPOSTA guarda em `metadata.resposta_interativa`. A
 * linha em si é `text` com o rótulo no corpo — isto é a procedência, para a
 * tela mostrar "escolheu na enquete" e o agente saber que foi um toque.
 */
export interface RespostaInterativa {
  formato: "enquete" | "lista" | "botao";
  /** `messages.id` da pergunta, quando a achamos. */
  mensagem_origem_id: string | null;
  pergunta: string | null;
  opcao_id: string | null;
  opcao_label: string;
}

export function respostaInterativaDaMetadata(metadata: unknown): RespostaInterativa | null {
  if (metadata === null || typeof metadata !== "object") return null;
  const bruto = (metadata as Record<string, unknown>).resposta_interativa;
  if (bruto === null || typeof bruto !== "object") return null;
  const r = bruto as Record<string, unknown>;
  if (r.formato !== "enquete" && r.formato !== "lista" && r.formato !== "botao") return null;
  if (typeof r.opcao_label !== "string") return null;
  return {
    formato: r.formato,
    mensagem_origem_id: typeof r.mensagem_origem_id === "string" ? r.mensagem_origem_id : null,
    pergunta: typeof r.pergunta === "string" ? r.pergunta : null,
    opcao_id: typeof r.opcao_id === "string" ? r.opcao_id : null,
    opcao_label: r.opcao_label,
  };
}
