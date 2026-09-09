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
  /**
   * ⚠️ BEST-EFFORT, A VALIDAR na instância viva. Sem esta flag, um áudio chega
   * como ANEXO de música (com ícone de nota musical), não como a BOLHA de voz —
   * na modalidade oficial é a mesma regra da Cloud API da Meta (`audio.voice`).
   * O nome do campo no contrato do provedor não está nos specs públicos; `voice`
   * é o mais provável. Só acompanha `media_type: "audio"`. Se o provedor recusar
   * campo desconhecido, é UMA linha para remover — ver `corpoDeEnvioStevo`.
   */
  voice?: boolean;
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
    // Nota de voz: pede a BOLHA de voz em vez do anexo de música. Best-effort,
    // ver o campo `voice` no contrato acima — a validar na instância viva.
    if (env.kind === "audio") corpo.voice = true;
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

export interface CorpoDeTemplateStevo {
  to: string;
  template_name: string;
  template_language?: string;
  template_params?: string[];
}

/**
 * Nosso envio de template → o corpo do provedor. ⚠️ FORMATO A VALIDAR (docs SPA)
 * — ver `adapters/stevo.ts:sendTemplate`. Pura para ser testável sem rede.
 *
 * `{{1}}`, `{{2}}`… viram posições NA ORDEM NUMÉRICA. Chave não-numérica fica de
 * fora em vez de entrar em ordem alfabética: ordem inventada manda o valor
 * errado para o lugar errado, e o cliente recebe o nome de outra pessoa.
 */
export function corpoDeTemplateStevo(
  name: string,
  language: string,
  values: Record<string, string>,
): CorpoDeTemplateStevo {
  const params = Object.keys(values)
    .filter((k) => /^\d+$/.test(k))
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => values[k] ?? "");
  return {
    to: "", // preenchido pelo chamador; mantém a forma estável para o teste
    template_name: name,
    ...(language ? { template_language: language } : {}),
    ...(params.length ? { template_params: params } : {}),
  };
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
