/**
 * Qual mensagem o cliente CITOU ao responder ("Gostei desse" em cima de uma foto).
 *
 * ## Por que isto existe
 *
 * O ingest gravava a resposta solta. Medido numa floricultura real
 * (2026-10-15): a atendente mandou várias fotos de buquês com preço, a cliente
 * citou uma e escreveu "Gostei desse", e o agente respondeu "recebi várias
 * fotos e não consegui ver qual você quis dizer" — duas vezes. A informação
 * estava no payload o tempo todo; ninguém a lia.
 *
 * O WAHA entrega a citação em dois lugares, conforme engine e versão:
 *   1. `replyTo.id` — o campo normalizado do WAHA;
 *   2. `_data.message.<tipo>.contextInfo.stanzaId` — o protocolo cru (NOWEB),
 *      o mesmo campo que `resposta-interativa.ts` já lê para a lista.
 * Os dois carregam o id BARE da mensagem citada.
 *
 * `replyTo` NÃO entra no schema do envelope (`envelope.ts`), de propósito: lá
 * ele recusaria o payload INTEIRO se viesse num formato inesperado — uma
 * citação malformada derrubaria a mensagem do cliente. Aqui ele é lido solto,
 * e o que não tem a forma esperada vira "sem citação".
 */
import type { WahaPayload } from "@/lib/waha/envelope";
import { bareWaMessageId } from "@/lib/waha/message-id";

/** Envelopes que o WhatsApp põe em volta do conteúdo real. */
const EMBRULHOS = ["ephemeralMessage", "viewOnceMessage", "viewOnceMessageV2", "documentWithCaptionMessage"];

function objeto(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function stanzaDoProtocolo(mensagem: unknown): string | null {
  let atual = objeto(mensagem);
  for (let i = 0; atual !== null && i < 4; i++) {
    const chave = EMBRULHOS.find((k) => objeto(objeto(atual![k])?.message) !== null);
    if (!chave) break;
    atual = objeto(objeto(atual[chave])!.message);
  }
  if (atual === null) return null;
  for (const conteudo of Object.values(atual)) {
    const stanza = objeto(objeto(conteudo)?.contextInfo)?.stanzaId;
    if (typeof stanza === "string" && stanza !== "") return stanza;
  }
  return null;
}

/**
 * Id bare da mensagem citada, ou `null`. Só devolve id com o alfabeto que o
 * WhatsApp usa: o valor vai para um filtro do PostgREST, e aceitar vírgula ou
 * parêntese ali seria abrir o filtro para quem controla o payload.
 */
export function idDaMensagemCitada(p: WahaPayload): string | null {
  const replyTo = objeto((p as Record<string, unknown>).replyTo);
  const bruto =
    (typeof replyTo?.id === "string" && replyTo.id !== "" ? replyTo.id : null) ??
    stanzaDoProtocolo(p._data?.message);
  if (bruto === null) return null;
  const bare = bareWaMessageId(bruto);
  return /^[A-Za-z0-9]{6,64}$/.test(bare) ? bare : null;
}
