/**
 * Extrator de atribuição de anúncio da mensagem crua do transporte por QR.
 *
 * Mora em `lib/waha/` pelo mesmo motivo do irmão em `lib/channels/`: nomear o
 * provider aqui é legítimo (é o próprio canal), e fora daqui o
 * `pnpm lint:channels` reprova. O formato agnóstico e a gravação estão em
 * `lib/leads/atribuicao-de-anuncio.ts`.
 */
import type { AtribuicaoDeAnuncio, Bruto } from "@/lib/leads/atribuicao-de-anuncio";
import { obj, str } from "@/lib/leads/atribuicao-de-anuncio";

/**
 * `contextInfo.externalAdReply` do Baileys — o mesmo dado do anúncio,
 * embutido na PRÓPRIA mensagem que o app do cliente manda ao clicar num
 * anúncio "Clique para o WhatsApp". `messageRaw` é `_data.message` do payload
 * do WAHA (NOWEB) — a forma bruta do Baileys, sem normalização.
 *
 * ⚠️ A chave é `externalAdReply`, e NÃO `externalAdReplyInfo`. Esta função
 * procurou `externalAdReplyInfo` (o nome da mensagem no proto) desde que
 * nasceu, e nunca casou: medido em produção em 2026-10-13, 70 inbounds com
 * anúncio em `webhook_events_log` e ZERO contatos com `source = 'meta_ads'`.
 * O nome antigo segue aceito como alias, por precaução.
 *
 * O ad-reply pode chegar em qualquer tipo de mensagem com `contextInfo`
 * (o clique manda texto na maioria dos casos, daí `extendedTextMessage` vir
 * primeiro na lista de candidatos), então a busca varre os tipos comuns em
 * vez de assumir um só.
 */
export function extrairAtribuicaoWaha(messageRaw: unknown): AtribuicaoDeAnuncio | null {
  const m = obj(messageRaw);
  if (!m) return null;

  const candidatos = [
    obj(m.extendedTextMessage)?.contextInfo,
    obj(m.imageMessage)?.contextInfo,
    obj(m.videoMessage)?.contextInfo,
    obj(m.conversation) ? null : m.contextInfo,
  ];
  const contextInfo = candidatos.map(obj).find((c): c is Bruto => c !== null);
  const ad = obj(contextInfo?.externalAdReply) ?? obj(contextInfo?.externalAdReplyInfo);
  if (!ad || !contextInfo) return null;

  // O mesmo filtro que o irmão da API oficial aplica, e que aqui faltava: post
  // ORGÂNICO compartilhado não é anúncio pago. Sem esta linha, o primeiro
  // compartilhamento de um post carimba `meta_ads` no contato — e a guarda de
  // primeiro toque torna isso IRREVERSÍVEL pelo caminho normal.
  const tipo = str(ad.sourceType) ?? str(ad.source_type);
  if (tipo && tipo !== "ad") return null;

  const sourceId = str(ad.ctwaClid) ?? str(ad.sourceId);
  const titulo = str(ad.title);
  const sourceUrl = str(ad.sourceUrl);
  if (!sourceId && !titulo && !sourceUrl) return null;

  // `thumbnail` é a miniatura em base64 (~2 KB por clique, medido) — a URL
  // dela já está em `thumbnailUrl`. Fica fora da prova gravada no contato.
  // A origem da conversão mora ao lado do ad-reply, no `contextInfo`, e não
  // dentro dele — por isso entra na prova junto.
  const semMiniatura: Bruto = { ...ad };
  delete semMiniatura.thumbnail;
  const origemDaConversao = str(contextInfo.conversionSource);

  return {
    plataforma: "meta_ads",
    sourceId,
    titulo,
    corpo: str(ad.body),
    sourceUrl,
    detalhes: {
      idDoAnuncio: str(ad.sourceId),
      ctwaClid: str(ad.ctwaClid),
      tipoDaOrigem: tipo,
      appDeOrigem: str(ad.sourceApp) ?? str(contextInfo.entryPointConversionApp),
      tipoDeMidia: str(ad.mediaType),
      urlDaMidia: str(ad.mediaUrl),
      urlDaMiniatura: str(ad.thumbnailUrl) ?? str(ad.originalImageUrl),
      origemDaConversao,
    },
    bruto: origemDaConversao ? { ...semMiniatura, conversionSource: origemDaConversao } : semMiniatura,
  };
}
