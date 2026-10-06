/**
 * Baixa a mídia de ENTRADA de uma conta Stevo.
 *
 * Medido em produção (2026-10-06): a Stevo resolve a mídia do cliente e manda o
 * link pronto em `stevo.media.url` (ver `./webhook.ts`) — um object storage
 * público, sem assinatura na query, que responde 200 sem credencial. Por isso
 * este fetch NÃO leva nenhuma credencial do tenant: o host vem do payload, e
 * mandar a chave para um host escolhido pelo payload seria entregá-la.
 *
 * A URL ainda assim vem do payload de um webhook autenticado só pelo token no
 * caminho, então passa pelo mesmo par de guardas do irmão Zernio
 * (`../adapters/zernio.ts`): o textual recusa esquema, http em produção e faixa
 * privada; o de DNS julga o IP resolvido e fecha o rebinding. Redirecionamento
 * não é seguido — um 3xx levaria o fetch para um host que nenhuma guarda viu.
 *
 * Sem este baixador, o worker de mídia pulava toda mídia da Stevo como
 * "canal_sem_midia_de_entrada": o áudio entrava sem bytes, nunca era transcrito,
 * e o agente respondia a um áudio que não ouviu.
 */
import { assertDestinoResolvidoSeguro } from "@/lib/automation/outbound-ip";
import { assertSafeOutboundUrl } from "@/lib/automation/outbound-url";
import { MAX_MEDIA_BYTES, MediaTooLargeError, type FetchedMedia } from "@/lib/messaging/media/types";

const TEMPO_MAXIMO_MS = 30_000;

export async function baixarMidiaStevo(
  url: string,
  hintMime: string | null | undefined,
  deps: {
    fetchImpl?: typeof fetch;
    conferirDestino?: (host: string) => Promise<void>;
  } = {},
): Promise<FetchedMedia> {
  assertSafeOutboundUrl(url);
  await (deps.conferirDestino ?? assertDestinoResolvidoSeguro)(new URL(url).hostname);

  const res = await (deps.fetchImpl ?? fetch)(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(TEMPO_MAXIMO_MS),
  });
  if (res.status >= 300 && res.status < 400) throw new Error(`stevo_media_redirect: ${res.status}`);
  if (!res.ok) throw new Error(`stevo_media_failed: ${res.status}`);

  const declarado = Number(res.headers.get("content-length") ?? 0);
  if (declarado > MAX_MEDIA_BYTES) throw new MediaTooLargeError();
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength > MAX_MEDIA_BYTES) throw new MediaTooLargeError();

  // O `content-type` da resposta manda sobre a dica do webhook: é o que o
  // arquivo realmente é, e é ele que vai no upload.
  const mime =
    res.headers.get("content-type")?.split(";")[0]?.trim() || hintMime || "application/octet-stream";
  return { buffer, mime };
}
