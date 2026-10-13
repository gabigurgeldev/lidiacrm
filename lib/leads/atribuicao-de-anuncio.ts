/**
 * Atribuição de anúncio — de qual campanha um contato veio.
 *
 * Este arquivo é a parte AGNÓSTICA: o formato do dado atribuído e a gravação
 * dele no contato. Quem sabe ler o payload é o transporte, cada um no seu
 * módulo — é a doutrina de restrição de canal (`docs/doctrine/restricao-de-canal.md`,
 * invariante 1: nenhuma feature nomeia um provider), e o `pnpm lint:channels`
 * reprova quem a quebra.
 *
 * Os extratores vivem um por transporte, cada um na pasta do seu canal —
 * `atribuicao-de-anuncio-oficial.ts` para o `referral` do webhook da API
 * oficial, e o homônimo na pasta do transporte por QR para o mesmo dado quando
 * ele vem embutido na própria mensagem. Procure por `extrairAtribuicao` para
 * achar os dois; citar o caminho aqui é justamente o que o invariante proíbe.
 *
 * Não há extrator de Google Ads: não existe mecanismo nativo equivalente para
 * WhatsApp. Aquele caminho depende de uma landing page que capture o `gclid` e
 * embuta um código de rastreio na mensagem pré-preenchida, e essa LP ainda não
 * existe.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

export type PlataformaDeAnuncio = "meta_ads" | "google_ads";

export interface AtribuicaoDeAnuncio {
  plataforma: PlataformaDeAnuncio;
  /** `ctwa_clid` — identifica o clique específico que abriu a conversa. */
  sourceId: string | null;
  /** Título/headline do anúncio, quando o payload o traz. */
  titulo: string | null;
  corpo: string | null;
  sourceUrl: string | null;
  /**
   * O resto do que o anúncio diz de si, já sem a forma do provider. Opcional
   * porque o primeiro toque do contato não precisa dele — quem precisa é quem
   * repassa o anúncio para fora (ver `anuncioPublico`).
   */
  detalhes?: DetalhesDoAnuncio;
  /** Payload de onde isto foi extraído — nunca descartado, é a prova. */
  bruto: Record<string, unknown>;
}

export interface DetalhesDoAnuncio {
  /** Id do ANÚNCIO na plataforma — o mesmo para todo clique nele. */
  idDoAnuncio: string | null;
  /** Id do CLIQUE — um por pessoa que clicou. É o que o rastreio de conversão casa. */
  ctwaClid: string | null;
  /** `"ad"` para anúncio pago; o extrator já recusa o orgânico. */
  tipoDaOrigem: string | null;
  /** App onde o anúncio rodou (`instagram`, `facebook`…), quando o payload diz. */
  appDeOrigem: string | null;
  tipoDeMidia: string | null;
  urlDaMidia: string | null;
  urlDaMiniatura: string | null;
  /** De onde a conversão veio, na palavra da plataforma (ex.: `FB_Ads`). */
  origemDaConversao: string | null;
}

/**
 * O anúncio na forma que SAI do CRM — para o webhook do cliente e para a
 * própria mensagem que o trouxe. snake_case como o resto da API pública.
 *
 * Projeção explícita, nunca o `bruto`: o payload cru carrega a miniatura em
 * base64 (kilobytes por mensagem) e campos internos da plataforma que nenhum
 * sistema de rastreio usa. Mudar o que sai aqui é mudar contrato com sistema
 * de terceiro — acrescente, não renomeie.
 */
export interface AnuncioPublico {
  platform: PlataformaDeAnuncio;
  source_type: string | null;
  source_id: string | null;
  source_url: string | null;
  source_app: string | null;
  title: string | null;
  description: string | null;
  media_type: string | null;
  media_url: string | null;
  thumbnail_url: string | null;
  ctwa_clid: string | null;
  conversion_source: string | null;
}

export function anuncioPublico(a: AtribuicaoDeAnuncio): AnuncioPublico {
  const d = a.detalhes;
  return {
    platform: a.plataforma,
    source_type: d?.tipoDaOrigem ?? null,
    source_id: d?.idDoAnuncio ?? null,
    source_url: a.sourceUrl,
    source_app: d?.appDeOrigem ?? null,
    title: a.titulo,
    description: a.corpo,
    media_type: d?.tipoDeMidia ?? null,
    media_url: d?.urlDaMidia ?? null,
    thumbnail_url: d?.urlDaMiniatura ?? null,
    ctwa_clid: d?.ctwaClid ?? null,
    conversion_source: d?.origemDaConversao ?? null,
  };
}

const CHAVES_DO_ANUNCIO_PUBLICO: ReadonlyArray<keyof AnuncioPublico> = [
  "platform",
  "source_type",
  "source_id",
  "source_url",
  "source_app",
  "title",
  "description",
  "media_type",
  "media_url",
  "thumbnail_url",
  "ctwa_clid",
  "conversion_source",
];

/**
 * Relê um `AnuncioPublico` gravado (na mensagem ou no contato) aceitando só as
 * chaves do contrato. Quem lê do banco não confia na forma: a linha pode ter
 * sido escrita por uma versão anterior, ou à mão.
 */
export function lerAnuncioPublico(v: unknown): AnuncioPublico | null {
  const o = obj(v);
  if (!o || o.platform === undefined) return null;
  const out: Record<string, unknown> = {};
  for (const k of CHAVES_DO_ANUNCIO_PUBLICO) out[k] = o[k] ?? null;
  return out as unknown as AnuncioPublico;
}

export type Bruto = Record<string, unknown>;
export const obj = (v: unknown): Bruto | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Bruto) : null;
export const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;

/**
 * Grava o anúncio na MENSAGEM que o trouxe (`messages.metadata.anuncio`).
 *
 * O contato guarda só o primeiro toque; a mensagem guarda TODO clique — a
 * pessoa que já era cliente e clicou num anúncio novo também é uma conversão,
 * e é ela que a automação "Quando chegar mensagem" enxerga
 * (`lib/automation/engine.ts` → `buildContext` carrega a mensagem).
 *
 * Para o canal que grava a mensagem ANTES de ler o anúncio. Quem lê antes
 * (o transporte por QR) põe `anuncio` direto no insert e não passa por aqui.
 * Read-modify-write do jsonb é aceitável: a linha acabou de nascer e só este
 * passo da ingestão escreve nela.
 */
export async function gravarAnuncioNaMensagem(
  admin: SupabaseClient,
  organizationId: string,
  messageId: string,
  atribuicao: AtribuicaoDeAnuncio,
): Promise<void> {
  const { data, error: leitura } = await admin
    .from("messages")
    .select("metadata")
    .eq("id", messageId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (leitura || !data) return;
  const metadata = obj((data as { metadata?: unknown }).metadata) ?? {};
  const { error } = await admin
    .from("messages")
    .update({ metadata: { ...metadata, anuncio: anuncioPublico(atribuicao) } })
    .eq("id", messageId)
    .eq("organization_id", organizationId);
  if (error) {
    logger.error("[atribuicao-de-anuncio] falha ao gravar anúncio na mensagem", {
      message_id: messageId,
      detail: error.message.slice(0, 200),
    });
  }
}

/**
 * Grava a atribuição no CONTATO — só na primeira vez.
 *
 * Primeiro toque: uma vez gravada, não muda. A pessoa pode clicar em outro
 * anúncio meses depois, numa conversa já aberta — isso não deveria reescrever
 * de onde ela veio ORIGINALMENTE, que é o dado que explica a existência do
 * relacionamento. `fn_estampar_atribuicao_de_anuncio` faz a guarda e o merge
 * de `source_metadata` ATOMICAMENTE no banco (não aqui): duas mensagens quase
 * simultâneas do mesmo contato novo não podem correr a corrida de leitura e
 * escrita em JS e uma pisar na outra.
 */
export async function estamparAtribuicaoDoContato(
  admin: SupabaseClient,
  contactId: string,
  atribuicao: AtribuicaoDeAnuncio,
): Promise<void> {
  const { error } = await admin.rpc("fn_estampar_atribuicao_de_anuncio" as never, {
    p_contact: contactId,
    p_platform: atribuicao.plataforma,
    p_metadata: {
      ad_platform: atribuicao.plataforma,
      ad_source_id: atribuicao.sourceId,
      ad_title: atribuicao.titulo,
      ad_body: atribuicao.corpo,
      ad_source_url: atribuicao.sourceUrl,
      ad_raw: atribuicao.bruto,
      ad_public: anuncioPublico(atribuicao),
      ad_captured_at: new Date().toISOString(),
    },
  } as never);

  if (error) {
    // `logger.error`, não `console.error`: o DoD proíbe console em código
    // mergeado, e um erro que só existe no stdout do contêiner não chega a
    // ninguém. A falha é tolerada de propósito — perder a atribuição não pode
    // derrubar a entrada da mensagem — mas ela precisa aparecer.
    logger.error("[atribuicao-de-anuncio] falha ao estampar contato", {
      contact_id: contactId,
      plataforma: atribuicao.plataforma,
      detail: error.message.slice(0, 200),
    });
  }
}
