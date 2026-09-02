/**
 * Nosso envelope de saída → o corpo que o intermediário de conta espera.
 *
 * ═══ O contrato dele, medido no OpenAPI ═══
 *
 *   POST /v1/instances/{id}/messages
 *   { to, text? , media_url?, media_type?: image|video|audio|document,
 *     caption?, filename?, cloud_api? }
 *   → { engine, sent, result }
 *
 * Um endpoint só serve as DUAS modalidades (oficial e por QR) — as credenciais
 * do servidor da instância são resolvidas do lado dele. É o que permite este
 * adapter ter um caminho de envio único em vez de dois.
 *
 * ═══ O que a resposta NÃO garante ═══
 *
 * O spec declara `result` como objeto livre: onde mora o id da mensagem não está
 * documentado, e ele varia com o motor (o oficial devolve `wamid`, o outro
 * devolve a chave do WhatsApp). Por isso `idDaResposta` procura em vários
 * lugares e devolve `null` sem drama quando não acha.
 *
 * `null` NÃO é falha de envio: `sent: true` já disse que saiu. É "saiu e não
 * consigo casar o eco do webhook com esta linha", o que degrada o dedup — não a
 * entrega. Tratar como erro faria a tela marcar `failed` numa mensagem que o
 * cliente recebeu, que é a pior das duas.
 */
import type { OutboundEnvelope } from "../types";

export interface CorpoDeEnvioStevo {
  to: string;
  text?: string;
  media_url?: string;
  media_type?: "image" | "video" | "audio" | "document";
  caption?: string;
  filename?: string;
}

/**
 * O `kind` do CRM → o `media_type` dele.
 *
 * `sticker` e `location` caem em `document`/texto porque o endpoint não os tem:
 * mandar um `media_type` que ele não conhece é 4xx, e perder a mensagem é pior
 * que entregá-la num formato vizinho. `contact` não passa por aqui — o adapter o
 * converte em texto antes, já que não há campo de vcard neste contrato.
 */
function tipoDeMidia(kind: string): CorpoDeEnvioStevo["media_type"] {
  if (kind === "image") return "image";
  if (kind === "video") return "video";
  if (kind === "audio") return "audio";
  return "document";
}

export function corpoDeEnvioStevo(env: OutboundEnvelope): CorpoDeEnvioStevo {
  const corpo: CorpoDeEnvioStevo = { to: env.to };

  if (env.media?.url) {
    corpo.media_url = env.media.url;
    corpo.media_type = tipoDeMidia(env.kind);
    // A legenda vai em `caption` e NÃO em `text`: com os dois preenchidos o
    // provedor manda duas mensagens, e o cliente recebe a foto e um texto solto
    // repetindo a legenda.
    if (env.body) corpo.caption = env.body;
    if (env.media.filename) corpo.filename = env.media.filename;
    return corpo;
  }

  if (env.body) corpo.text = env.body;
  return corpo;
}

/**
 * Onde quer que o id da mensagem esteja na resposta.
 *
 * Varredura rasa e depois profunda em vez de um caminho fixo, porque o caminho
 * fixo não está documentado — e um caminho fixo errado devolve `null` sempre,
 * silenciosamente, quebrando o dedup do eco sem nenhum sintoma até alguém
 * reparar em mensagens duplicadas na thread.
 */
export function idDaRespostaStevo(resposta: unknown): string | null {
  const CHAVES = ["id", "message_id", "messageId", "wamid", "key_id", "external_id"];

  const buscar = (v: unknown, profundidade: number): string | null => {
    if (profundidade > 4 || v === null || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    for (const k of CHAVES) {
      const achado = o[k];
      if (typeof achado === "string" && achado.trim()) return achado.trim();
    }
    for (const filho of Object.values(o)) {
      const achado = buscar(filho, profundidade + 1);
      if (achado) return achado;
    }
    return null;
  };

  return buscar(resposta, 0);
}
