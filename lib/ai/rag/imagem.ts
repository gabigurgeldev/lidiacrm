/**
 * FOTOS DO ACERVO — as regras que a tela, a rota de envio e o agente dividem.
 *
 * Este módulo é PURO (sem `node:crypto`, sem Supabase) porque a tela de
 * Conhecimento também o importa: o diálogo recusa no navegador o mesmo arquivo
 * que a rota recusaria, em vez de deixar a pessoa esperar o upload para ouvir
 * "formato não suportado". O apelido que o agente usa mora em
 * `apelido-da-foto.ts`, que é só de servidor.
 *
 * ONDE A FOTO MORA, e por quê: `whatsapp-media/{org}/materiais/{uuid}.{ext}`.
 *
 *  - No bucket do WhatsApp, e não no `ai-policy` dos documentos, porque o envio
 *    assina a URL a partir dele (o `sendMessageHandler` só assina
 *    `whatsapp-media`), e o `ai-policy` só aceita pdf/markdown/texto.
 *  - Numa pasta própria, fora de `{org}/{conversa}/`, porque a foto é ativo da
 *    EMPRESA e não do contato: o redact da LGPD apaga a mídia por conversa, e
 *    anonimizar uma cliente não pode apagar a foto que o agente manda a todas.
 *    É o mesmo raciocínio de `{org}/disparos/` no disparo em massa.
 */

/** 5 MB — o teto de imagem do WhatsApp, o mesmo do disparo em massa. */
export const TAMANHO_MAXIMO_DA_FOTO = 5 * 1024 * 1024;

/** Formatos que todo canal de mensagem entrega como foto. */
export const FORMATOS_DE_FOTO = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export type MimeDeFoto = keyof typeof FORMATOS_DE_FOTO;

/** `accept` do `<input type="file">` — derivado, para não divergir da rota. */
export const ACCEPT_DE_FOTO = Object.keys(FORMATOS_DE_FOTO).join(",");

export function eMimeDeFoto(mime: string): mime is MimeDeFoto {
  return Object.prototype.hasOwnProperty.call(FORMATOS_DE_FOTO, mime);
}

/** A pasta das fotos de uma organização, com a barra final. */
export function pastaDeMateriais(orgId: string): string {
  return `${orgId}/materiais/`;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * O caminho é uma foto do acervo DESTA organização?
 *
 * Conferido no ENVIO, nunca confiado do banco: `source_metadata` é jsonb que um
 * manager escreve pela REST, e quem assina a URL é a service role. Sem esta
 * conferência, um `blob_path` trocado faria o agente mandar ao cliente qualquer
 * arquivo do bucket — de outra conversa ou de outra organização.
 */
export function caminhoDeMaterialValido(path: unknown, orgId: string): path is string {
  if (typeof path !== "string" || !UUID_SOLTO.test(orgId)) return false;
  const re = new RegExp(`^${orgId}/materiais/${UUID}\\.(jpg|png|webp)$`);
  return re.test(path);
}

const UUID_SOLTO = new RegExp(`^${UUID}$`);

/**
 * Os primeiros bytes batem com o formato declarado?
 *
 * O `type` do arquivo vem do navegador, isto é, do cliente. Conferir a
 * assinatura impede que um `.html` renomeado entre como "foto" e seja depois
 * servido por URL assinada ao WhatsApp do cliente.
 */
export function bytesConferemComOFormato(bytes: Uint8Array, mime: MimeDeFoto): boolean {
  const b = (i: number) => bytes[i];
  switch (mime) {
    case "image/jpeg":
      return bytes.length >= 3 && b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff;
    case "image/png":
      return (
        bytes.length >= 8 &&
        b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47 &&
        b(4) === 0x0d && b(5) === 0x0a && b(6) === 0x1a && b(7) === 0x0a
      );
    case "image/webp":
      return (
        bytes.length >= 12 &&
        b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 && // RIFF
        b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50 // WEBP
      );
  }
}

/** Limites da descrição: curta o bastante para virar um trecho, longa o bastante para cartela de cores. */
export const DESCRICAO_DA_FOTO_MIN = 3;
export const DESCRICAO_DA_FOTO_MAX = 2000;
