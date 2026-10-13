/**
 * Como o canal por QR devolve a escolha numa enquete ou lista nossa.
 *
 * O voto e a seleção NÃO chegam como mensagem comum:
 *
 *   - enquete → evento próprio `poll.vote`, com `vote.selectedOptions` (o TEXTO
 *     das opções votadas) e `poll.id` (o id da NOSSA mensagem de enquete).
 *     Sem corpo nem mídia, ele cairia na guarda de "evento vazio" do ingest.
 *   - lista → `message.any` com `listResponseMessage` em `_data.message`, o
 *     `rowId` escolhido e o id da lista em `contextInfo.stanzaId`. O `body`
 *     pode vir vazio ou com o título CORTADO da linha.
 *
 * Isto só LÊ o formato do transporte. O que vira mensagem é decidido em
 * `lib/channels/resposta-interativa.ts`, igual para todo canal.
 *
 * ⚠️ O formato do `listResponseMessage` do NOWEB NÃO é documentado pelo
 * transporte. A extração segue o proto do WhatsApp (o mesmo que o transporte
 * serializa em `_data.message`) e tolera variações; o caso real precisa ser
 * capturado num aparelho e fixado como teste.
 */

/** O que o evento `poll.vote` traz, já estreitado. */
export interface VotoDeEnquete {
  idDoVoto: string | null;
  idDaEnquete: string;
  de: string | null;
  doProprioNumero: boolean;
  /** Vazio = a pessoa RETIROU o voto (ou o transporte não decifrou). */
  opcoesVotadas: string[];
  timestamp: number | null;
  /** O voto veio de um grupo — fora do binding do CRM. */
  emGrupo: boolean;
}

export function lerVotoDeEnquete(payload: Record<string, unknown>): VotoDeEnquete | null {
  const vote = payload.vote;
  const poll = payload.poll;
  if (vote === null || typeof vote !== "object" || poll === null || typeof poll !== "object") return null;
  const v = vote as Record<string, unknown>;
  const p = poll as Record<string, unknown>;
  if (typeof p.id !== "string" || p.id === "") return null;
  const selecionadas = Array.isArray(v.selectedOptions)
    ? v.selectedOptions.filter((x): x is string => typeof x === "string" && x.trim() !== "")
    : [];
  const para = [v.to, p.to, v.from].find((x): x is string => typeof x === "string") ?? "";
  return {
    idDoVoto: typeof v.id === "string" && v.id !== "" ? v.id : null,
    idDaEnquete: p.id,
    de: typeof v.from === "string" ? v.from : null,
    doProprioNumero: v.fromMe === true,
    opcoesVotadas: selecionadas,
    timestamp: typeof v.timestamp === "number" ? v.timestamp : null,
    emGrupo: para.endsWith("@g.us"),
  };
}

/** A seleção de uma lista, como o NOWEB a serializa em `_data.message`. */
export interface SelecaoDeLista {
  idDaLinha: string | null;
  titulo: string | null;
  /** Id da mensagem de lista respondida (`contextInfo.stanzaId`). */
  idDaLista: string | null;
}

/**
 * Invólucros do proto que escondem a mensagem de verdade um nível abaixo, em
 * `<invólucro>.message`. Conversa com mensagens temporárias manda TUDO dentro
 * de `ephemeralMessage`; sem desembrulhar, a escolha na lista some.
 */
const INVOLUCROS = [
  "ephemeralMessage",
  "viewOnceMessage",
  "viewOnceMessageV2",
  "viewOnceMessageV2Extension",
  "deviceSentMessage",
  "documentWithCaptionMessage",
] as const;

function desembrulhar(mensagem: Record<string, unknown>): Record<string, unknown> {
  let atual = mensagem;
  // Limite de profundidade: proto malformado não pode virar laço.
  for (let i = 0; i < 4; i++) {
    const chave = INVOLUCROS.find((k) => {
      const v = atual[k];
      return v !== null && typeof v === "object" && typeof (v as Record<string, unknown>).message === "object";
    });
    if (!chave) return atual;
    const interna = (atual[chave] as Record<string, unknown>).message;
    if (interna === null || typeof interna !== "object") return atual;
    atual = interna as Record<string, unknown>;
  }
  return atual;
}

export function lerSelecaoDeLista(mensagem: unknown): SelecaoDeLista | null {
  if (mensagem === null || typeof mensagem !== "object") return null;
  const lr = desembrulhar(mensagem as Record<string, unknown>).listResponseMessage;
  if (lr === null || typeof lr !== "object") return null;
  const l = lr as Record<string, unknown>;
  const reply = l.singleSelectReply;
  const idDaLinha =
    reply !== null && typeof reply === "object" && typeof (reply as Record<string, unknown>).selectedRowId === "string"
      ? ((reply as Record<string, unknown>).selectedRowId as string)
      : null;
  const ctx = l.contextInfo;
  const idDaLista =
    ctx !== null && typeof ctx === "object" && typeof (ctx as Record<string, unknown>).stanzaId === "string"
      ? ((ctx as Record<string, unknown>).stanzaId as string)
      : null;
  return { idDaLinha, titulo: typeof l.title === "string" ? l.title : null, idDaLista };
}
