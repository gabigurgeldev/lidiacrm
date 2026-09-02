/**
 * O que chega do intermediário de conta — lido DEFENSIVAMENTE, de propósito.
 *
 * ═══ ⚠️ O formato deste payload NÃO ESTÁ DOCUMENTADO ═══
 *
 * Isto não é desleixo de quem escreveu: os três specs publicados pelo provedor
 * (gestão, StevoManager v2 e a API oficial) descrevem o que se ENVIA a ele e o
 * que ele responde. Nenhum descreve o corpo dos eventos `MESSAGE` /
 * `SEND_MESSAGE` / `CONNECTION` que ele entrega no nosso endereço.
 *
 * Duas saídas eram possíveis, e a escolha aqui é deliberada:
 *
 *   (a) escrever um Zod estrito chutando os nomes dos campos. Um chute errado
 *       recusa o evento INTEIRO, e o sintoma é "as mensagens não chegam" sem
 *       nenhum erro apontando para cá.
 *   (b) ler por TENTATIVA sobre os nomes plausíveis e devolver `null` quando
 *       nada casa, deixando o evento cru arquivado (`abrirArquivoDoWebhook`)
 *       para quem for medir de verdade.
 *
 * (b) — porque o modo de falha dela é visível (o arquivo tem o corpo, e o
 * desfecho registrado diz `ignorado`), e o de (a) é silencioso.
 *
 * **Ao medir um evento real, aperte este parser.** O lugar certo é aqui, e o
 * comentário acima deve ser substituído pelo formato medido.
 *
 * ═══ Sem HMAC, e o que protege no lugar ═══
 *
 * O provedor não documenta assinatura de webhook. O que autentica a entrega é o
 * `webhook_path_token` no caminho — um segredo de 32 hex gerado por nós, único
 * por linha, rotacionado na exclusão do canal, e que só ele conhece porque só
 * ele recebeu a URL. É o mesmo desenho da rota neutra
 * (`app/api/v1/webhooks/channel/[token]`), e é mais fraco que HMAC num ponto
 * concreto: quem observar a URL uma vez pode reenviá-la. Não há como fechar essa
 * diferença sem o outro lado assinar.
 */

export type EventoStevo =
  | {
      tipo: "mensagem";
      /** `true` quando saiu do celular do operador, e não do CRM. */
      daEmpresa: boolean;
      externalId: string | null;
      /** Telefone do CLIENTE, só dígitos. */
      telefone: string | null;
      texto: string | null;
      midiaUrl: string | null;
      midiaMime: string | null;
      /** Tipo do CRM (`text`, `image`, …) já traduzido. */
      tipoDeMensagem: string;
      enviadaEm: Date;
    }
  | { tipo: "conexao"; estado: string | null }
  | { tipo: "ignorado"; motivo: string };

const CAMPOS_TEXTO = ["text", "body", "message", "caption", "conversation"];
const CAMPOS_TELEFONE = ["from", "phone", "phone_number", "sender", "number", "remoteJid", "chatId"];
const CAMPOS_ID = ["id", "message_id", "messageId", "wamid", "key_id", "external_id"];
const CAMPOS_MIDIA = ["media_url", "mediaUrl", "url", "file_url"];

function primeiroTexto(o: Record<string, unknown>, chaves: string[]): string | null {
  for (const k of chaves) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/**
 * Achata o payload num só nível de busca.
 *
 * Provedores costumam aninhar (`{data: {message: {...}}}`), e o nome do nível
 * intermediário é justamente o que não está documentado. Achatar torna a leitura
 * indiferente à profundidade — o custo é uma colisão de nome entre níveis, que
 * aqui é aceitável porque os campos procurados são todos do mesmo assunto.
 */
function achatar(v: unknown, profundidade = 0, acc: Record<string, unknown> = {}): Record<string, unknown> {
  if (profundidade > 4 || v === null || typeof v !== "object" || Array.isArray(v)) return acc;
  for (const [k, filho] of Object.entries(v as Record<string, unknown>)) {
    if (!(k in acc)) acc[k] = filho;
    achatar(filho, profundidade + 1, acc);
  }
  return acc;
}

/** Dígitos de um endereço de WhatsApp (`5531999998888@c.us` → `5531999998888`). */
function digitosDoEndereco(bruto: string | null): string | null {
  if (!bruto) return null;
  const digitos = bruto.split("@")[0]!.replace(/\D/g, "");
  return digitos.length >= 8 ? digitos : null;
}

function tipoDeMensagem(plano: Record<string, unknown>, temMidia: boolean): string {
  const declarado = primeiroTexto(plano, ["type", "message_type", "media_type"]);
  if (declarado) {
    const t = declarado.toLowerCase();
    if (["image", "video", "audio", "document", "sticker", "location", "contact"].includes(t)) {
      return t;
    }
    if (t === "voice" || t === "ptt") return "audio";
    if (t === "contacts") return "contact";
  }
  return temMidia ? "document" : "text";
}

export function lerEventoStevo(bruto: unknown): EventoStevo {
  if (bruto === null || typeof bruto !== "object") {
    return { tipo: "ignorado", motivo: "corpo_nao_e_objeto" };
  }
  const plano = achatar(bruto);

  const evento = (primeiroTexto(plano, ["event", "type", "action"]) ?? "").toUpperCase();
  if (evento.includes("CONNECTION") || evento.includes("QRCODE")) {
    return { tipo: "conexao", estado: primeiroTexto(plano, ["status", "state", "connection"]) };
  }

  const telefone = digitosDoEndereco(primeiroTexto(plano, CAMPOS_TELEFONE));
  const texto = primeiroTexto(plano, CAMPOS_TEXTO);
  const midiaUrl = primeiroTexto(plano, CAMPOS_MIDIA);

  // Sem remetente não há a quem atribuir a mensagem — e criar contato "sem
  // número" polui a base de um jeito que ninguém desfaz depois. Ignorar é a
  // resposta honesta; o corpo cru fica arquivado para quem for medir.
  if (!telefone) return { tipo: "ignorado", motivo: "sem_remetente_reconhecivel" };
  if (!texto && !midiaUrl) return { tipo: "ignorado", motivo: "sem_conteudo_reconhecivel" };

  const carimbo = plano.timestamp ?? plano.t ?? plano.sent_at ?? plano.date;
  // Segundos (epoch do WhatsApp) e milissegundos convivem no mesmo campo entre
  // provedores. O corte em 1e12 separa os dois sem precisar saber qual é —
  // errar aqui joga a mensagem para 1970 ou para o ano 50000, e nos dois casos
  // ela some da ordenação da thread.
  const enviadaEm =
    typeof carimbo === "number"
      ? new Date(carimbo < 1e12 ? carimbo * 1000 : carimbo)
      : typeof carimbo === "string" && !Number.isNaN(Date.parse(carimbo))
        ? new Date(carimbo)
        : new Date();

  return {
    tipo: "mensagem",
    // `fromMe` é o nome consagrado; `from_me` e o evento SEND_MESSAGE cobrem as
    // variações. Marcar errado aqui faz a mensagem do cliente aparecer como
    // nossa na thread — e o agente responder a si mesmo.
    daEmpresa:
      plano.fromMe === true || plano.from_me === true || evento.includes("SEND_MESSAGE"),
    externalId: primeiroTexto(plano, CAMPOS_ID),
    telefone,
    texto,
    midiaUrl,
    midiaMime: primeiroTexto(plano, ["mime", "mimetype", "mime_type", "content_type"]),
    tipoDeMensagem: tipoDeMensagem(plano, Boolean(midiaUrl)),
    enviadaEm,
  };
}
