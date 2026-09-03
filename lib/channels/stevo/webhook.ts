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
 * ─── ✅ MEDIDO: o motivo Oficial NÃO usa este chute ─────────────────────────
 *
 * O log abaixo mediu em produção: uma conta Oficial manda o envelope CRU da
 * WhatsApp Cloud API da Meta (`chaves: ["object","entry"]`) — não um formato
 * próprio da Stevo. Isso É documentado, só não pela Stevo: é o webhook da
 * Meta, estável há anos. `lerEventoCloudApiOficial` lê esse formato PRECISO —
 * mensagem, telefone e id vêm de `entry[0].changes[0].value.messages[0]`.
 *
 * O achatador genérico (`achatar`) NUNCA teria achado isso: ele para no
 * primeiro array (`profundidade`/`Array.isArray` na guarda), e da Meta pra
 * baixo é array em TODO nível (`entry` → `changes` → `messages`). Chaves
 * medidas batendo exatamente com `["object","entry"]` é a prova.
 *
 * O motivo pelo qual não generalizei o achatador pra descer em array: o modo
 * SM v2 (QR) usa o caminho antigo e nunca foi medido — alargar o achatador
 * mexeria nos dois formatos de uma vez, e só um está confirmado.
 *
 * ─── O log de `logger.info` abaixo é o instrumento pra medir o que falta ────
 *
 * `webhook_events_log` guarda o corpo inteiro, mas até isso ser lido (banco
 * inacessível numa instalação self-host é um cenário real, não hipotético) o
 * log estruturado é o que sobra. Ele nunca imprime VALOR de campo — só os
 * NOMES das chaves de primeiro nível (`Object.keys`, depois de achatar) e o
 * desfecho (`tipo`/`motivo`) — o bastante pra saber se o nome que este parser
 * chuta bate com o que a Stevo manda de verdade, sem violar a regra do
 * cabeçalho de `lib/logger.ts` (nunca corpo de mensagem, nunca telefone).
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
import { logger } from "@/lib/logger";

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

/** Primeiro elemento de um array, se for um objeto — como a Cloud API sempre envia. */
function primeiroDoArray(v: unknown): Record<string, unknown> | null {
  return Array.isArray(v) && v.length > 0 && typeof v[0] === "object" && v[0] !== null
    ? (v[0] as Record<string, unknown>)
    : null;
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

/**
 * WhatsApp Cloud API da Meta, formato exato — é o que a conta Oficial entrega
 * (medido, ver cabeçalho do arquivo). `entry`/`changes`/`messages` são arrays
 * de UM elemento por entrega; `[0]` é o caminho documentado pela própria Meta.
 */
function lerEventoCloudApiOficial(bruto: Record<string, unknown>): EventoStevo {
  const entry = primeiroDoArray(bruto.entry);
  const change = entry ? primeiroDoArray(entry.changes) : null;
  const value = change?.value as Record<string, unknown> | undefined;
  if (!value) return { tipo: "ignorado", motivo: "cloud_api_sem_value" };

  const mensagem = primeiroDoArray(value.messages);
  if (!mensagem) {
    // `statuses` é o eco de entrega/leitura do que ESTE CRM mandou — não é
    // mensagem de cliente, e não é erro: é o formato normal da Cloud API para
    // status. Distinguir do "sem value" evita que os dois pareçam a mesma
    // falha quando um é rotina e o outro é formato inesperado.
    return {
      tipo: "ignorado",
      motivo: primeiroDoArray(value.statuses) ? "status_de_entrega" : "cloud_api_sem_mensagem",
    };
  }

  const telefone = digitosDoEndereco(typeof mensagem.from === "string" ? mensagem.from : null);
  if (!telefone) return { tipo: "ignorado", motivo: "sem_remetente_reconhecivel" };

  const tipo = typeof mensagem.type === "string" ? mensagem.type : null;
  const corpoTexto = mensagem.text as { body?: unknown } | undefined;
  const texto = typeof corpoTexto?.body === "string" ? corpoTexto.body : null;

  // Mídia: NÃO MEDIDO ainda (nenhuma mensagem com anexo chegou pra confirmar).
  // A doc da Stevo diz que mídia chega com `stevo.media` já resolvido — chuto
  // esse caminho como fallback defensivo; se errar, midiaUrl fica null e a
  // mensagem ainda assim é ingerida (texto/legenda, se houver).
  const midia = tipo ? (mensagem[tipo] as Record<string, unknown> | undefined) : undefined;
  const stevoMedia = (mensagem as { stevo?: { media?: { url?: unknown } } }).stevo?.media;
  const midiaUrl = typeof stevoMedia?.url === "string" ? stevoMedia.url : null;

  if (!texto && !midiaUrl && !midia?.caption) {
    return { tipo: "ignorado", motivo: "sem_conteudo_reconhecivel" };
  }

  const carimboSegundos = Number(mensagem.timestamp);
  const enviadaEm = Number.isFinite(carimboSegundos) && carimboSegundos > 0
    ? new Date(carimboSegundos * 1000)
    : new Date();

  return {
    tipo: "mensagem",
    // A Cloud API nunca entrega de volta o que ESTE CRM mandou — só `messages`
    // (do cliente) e `statuses` (eco de entrega/leitura, tratado acima). Sem o
    // conceito de "eco do celular do operador" que o modo QR tem.
    daEmpresa: false,
    externalId: typeof mensagem.id === "string" ? mensagem.id : null,
    telefone,
    texto: texto ?? (typeof midia?.caption === "string" ? midia.caption : null),
    midiaUrl,
    midiaMime: typeof midia?.mime_type === "string" ? midia.mime_type : null,
    tipoDeMensagem: tipoDeMensagem({ type: tipo ?? "" }, Boolean(midiaUrl)),
    enviadaEm,
  };
}

export function lerEventoStevo(bruto: unknown): EventoStevo {
  const evento = lerEventoStevoSemLog(bruto);
  logger.info("[webhook-stevo] evento lido", {
    tipo: evento.tipo,
    motivo: evento.tipo === "ignorado" ? evento.motivo : undefined,
    // Só os NOMES das chaves de primeiro nível, nunca o valor — é o bastante
    // pra comparar contra CAMPOS_TEXTO/CAMPOS_TELEFONE/CAMPOS_ID/CAMPOS_MIDIA
    // sem logar telefone nem corpo de mensagem.
    chaves:
      bruto !== null && typeof bruto === "object" && !Array.isArray(bruto)
        ? Object.keys(achatar(bruto))
        : [],
  });
  return evento;
}

function lerEventoStevoSemLog(bruto: unknown): EventoStevo {
  if (bruto === null || typeof bruto !== "object" || Array.isArray(bruto)) {
    return { tipo: "ignorado", motivo: "corpo_nao_e_objeto" };
  }
  // Conta Oficial: envelope cru da Cloud API, medido em produção (ver
  // cabeçalho do arquivo). `object` é o campo que a própria Meta usa pra
  // dizer "isto é um webhook de WhatsApp Business Account".
  if ((bruto as Record<string, unknown>).object === "whatsapp_business_account") {
    return lerEventoCloudApiOficial(bruto as Record<string, unknown>);
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
