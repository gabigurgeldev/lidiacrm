/**
 * Exportar uma conversa — a parte PURA: das linhas de `messages` para linhas de
 * relatório, na ordem em que aconteceram e no fuso da empresa.
 *
 * Quem pede é o dono: "no perfil do contato, exportar a conversa em PDF ou
 * Excel". O uso real é mostrar a um cliente, a um contador ou a um advogado o
 * que foi combinado — então o que importa é que o arquivo diga o que a tela diz,
 * inclusive o que a tela esconde por respeito: mensagem apagada sai como
 * "(mensagem apagada)", nunca com o texto que o cliente mandou tirar do ar.
 */
import { tagDeIdioma } from "@/lib/i18n/datas";
import { IDIOMA_PADRAO } from "@/lib/i18n/idiomas";

/** Teto de mensagens por arquivo. Acima disso o arquivo avisa que cortou. */
export const TETO_DA_EXPORTACAO = 10_000;

export interface MensagemParaExportar {
  id: string;
  direction: string;
  type: string;
  body: string | null;
  sent_via: string | null;
  sent_by_user_id: string | null;
  sent_at: string;
  status: string | null;
  revoked_at?: string | null;
}

export interface LinhaExportada {
  data: string;
  hora: string;
  direcao: "Recebida" | "Enviada";
  autor: string;
  tipo: string;
  texto: string;
  situacao: string;
}

const TIPO_LEGIVEL: Record<string, string> = {
  text: "Texto",
  image: "Imagem",
  video: "Vídeo",
  audio: "Áudio",
  document: "Documento",
  sticker: "Figurinha",
  location: "Localização",
  contact: "Contato",
  template: "Modelo",
};

const SITUACAO_LEGIVEL: Record<string, string> = {
  queued: "Na fila",
  sending: "Enviando",
  sent: "Enviada",
  delivered: "Entregue",
  read: "Lida",
  failed: "Falhou",
};

function autorDaMensagem(m: MensagemParaExportar, nomes: ReadonlyMap<string, string>): string {
  if (m.direction !== "outbound") return "Cliente";
  if (m.sent_via === "ai") return "Automático";
  if (m.sent_via === "external_device") return "Celular da empresa";
  if (m.sent_by_user_id) return nomes.get(m.sent_by_user_id) ?? "Atendente";
  if (m.sent_via === "automation") return "Automação";
  if (m.sent_via === "system") return "Sistema";
  // `crm`/`user` sem autor gravado: saiu da tela do CRM, por alguém da equipe.
  return "Atendente";
}

function textoDaMensagem(m: MensagemParaExportar): string {
  if (m.revoked_at) return "(mensagem apagada)";
  const corpo = (m.body ?? "").trim();
  if (m.type === "text" || m.type === "template") return corpo;
  const rotulo = `[${TIPO_LEGIVEL[m.type] ?? m.type}]`;
  return corpo ? `${rotulo} ${corpo}` : rotulo;
}

/**
 * Linhas do relatório, da mais ANTIGA para a mais nova — a ordem de leitura de
 * uma conversa. `fuso` é o da empresa (`organizations.timezone`): a hora que o
 * atendente viu na tela é a hora que o arquivo mostra.
 */
export function linhasDaConversa(
  mensagens: readonly MensagemParaExportar[],
  fuso: string,
  nomes: ReadonlyMap<string, string> = new Map(),
  /** Idioma de quem baixa o arquivo (`tagDeIdioma`). */
  tag: string = tagDeIdioma(IDIOMA_PADRAO),
): LinhaExportada[] {
  const fmtData = new Intl.DateTimeFormat(tag, {
    timeZone: fuso,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const fmtHora = new Intl.DateTimeFormat(tag, {
    timeZone: fuso,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return [...mensagens]
    .sort((a, b) => a.sent_at.localeCompare(b.sent_at) || a.id.localeCompare(b.id))
    .map((m) => {
      const quando = new Date(m.sent_at);
      return {
        data: fmtData.format(quando),
        hora: fmtHora.format(quando),
        direcao: m.direction === "outbound" ? "Enviada" : "Recebida",
        autor: autorDaMensagem(m, nomes),
        tipo: TIPO_LEGIVEL[m.type] ?? m.type,
        texto: textoDaMensagem(m),
        situacao: m.direction === "outbound" ? (SITUACAO_LEGIVEL[m.status ?? ""] ?? "") : "",
      };
    });
}

/** Fuso válido ou o de São Paulo — um fuso inválido derrubaria o `Intl`. */
export function fusoSeguro(fuso: string | null | undefined): string {
  if (!fuso) return "America/Sao_Paulo";
  try {
    // Só valida o fuso — o idioma não importa aqui.
    new Intl.DateTimeFormat(undefined, { timeZone: fuso });
    return fuso;
  } catch {
    return "America/Sao_Paulo";
  }
}

/** `Maria Souza` + data → `conversa-maria-souza-2026-09-29`. */
export function nomeDoArquivo(nomeDoContato: string, agora: Date): string {
  const base = nomeDoContato
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `conversa-${base || "contato"}-${agora.toISOString().slice(0, 10)}`;
}

/**
 * Texto que a fonte padrão do PDF consegue desenhar.
 *
 * A Helvetica embutida do gerador cobre o Latin-1 (acentos do português
 * inclusos), mas não emoji nem outros alfabetos — esses viravam quadrados ou
 * sumiam do meio da frase. Trocá-los por nada deixa a frase legível; o Excel
 * recebe o texto original, completo.
 */
export function textoParaPdf(texto: string): string {
  return texto.replace(/[^\u0009\u000A\u000D -ÿ–—‘’“”•…€]/gu, "");
}
