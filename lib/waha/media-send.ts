/**
 * Plano de envio de mídia WAHA por tipo de mensagem (Onda 2). Puro — o
 * WahaClient executa. sendVoice: WhatsApp só aceita OGG/OPUS; convert:true
 * pede conversão ao WAHA (contingência NOWEB Core registrada no plano).
 */
export interface OutboundMedia {
  url: string;
  mime: string;
  filename?: string | null;
  caption?: string | null;
  /**
   * O arquivo já está no formato do WhatsApp (`paraVideoDoWhatsApp`). Vídeo
   * pronto vai com `convert: false`: o `convert: true` faz o WAHA reencodar o
   * vídeo inteiro A CADA destinatário, e foi isso que derrubou o WhatsApp de
   * todas as organizações num disparo com vídeo (2026-10-01).
   */
  pronto?: boolean;
}

export interface WahaSendPlan {
  endpoint: "sendImage" | "sendVideo" | "sendVoice" | "sendFile";
  payload: Record<string, unknown>;
}

export function wahaSendPlanFor(kind: string, media: OutboundMedia): WahaSendPlan {
  const file: Record<string, unknown> = { url: media.url, mimetype: media.mime };
  if (media.filename) file.filename = media.filename;

  switch (kind) {
    case "image":
      return { endpoint: "sendImage", payload: { file, ...(media.caption ? { caption: media.caption } : {}) } };
    case "video":
      return {
        endpoint: "sendVideo",
        payload: { file, convert: !media.pronto, ...(media.caption ? { caption: media.caption } : {}) },
      };
    case "audio":
      return { endpoint: "sendVoice", payload: { file, convert: true } };
    default:
      return { endpoint: "sendFile", payload: { file, ...(media.caption ? { caption: media.caption } : {}) } };
  }
}
