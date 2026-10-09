/**
 * Marca-d'água da compactação: compactar quando a conversa ANDOU, não a cada
 * mensagem.
 *
 * ## O defeito
 *
 * `maybeCompact` dispara quando a janela do histórico tem ≥ `triggerMessages`
 * mensagens (padrão 40). A janela é a das últimas N mensagens — N vem da versão
 * do agente (`history_message_window`). Com N ≥ 40, a janela fica cheia para
 * sempre depois da 40ª mensagem, e TODO turno dali em diante paga duas chamadas
 * de IA a mais (flush + compactação) para resumir quase a mesma coisa que já
 * resumiu no turno anterior.
 *
 * ## A regra
 *
 * Compacta de novo só quando entraram, desde a última compactação, pelo menos
 * metade do gatilho em mensagens novas. Entre uma e outra, o turno usa o resumo
 * DURÁVEL do checkpoint (que o fechamento de cada turno reescreve a partir do
 * que o modelo viu, inclusive o resumo compactado) e apara o histórico ao mesmo
 * orçamento da compactação — sem chamada de IA.
 *
 * Sem resumo durável (conversa importada, checkpoint vazio), compacta: não há o
 * que reaproveitar.
 *
 * ## Por que não é coluna nova
 *
 * A marca já existe: a última linha de `llm_calls` com `purpose = 'compaction'`
 * deste contato, e as mensagens dele criadas depois dela. É dado CALCULÁVEL
 * (doutrina DIRC, "C"); uma coluna seria uma segunda fonte que pode divergir. Se
 * a retenção apagar a linha de `llm_calls`, a próxima compactação simplesmente
 * acontece — a direção segura.
 */

import type pg from 'pg';

export interface MarcaDaCompactacao {
  ultima: Date | null;
  novasDesdeEla: number;
}

/** Quantas mensagens novas justificam compactar de novo. */
export function passoDaCompactacao(gatilho: number): number {
  return Math.max(1, Math.floor(gatilho / 2));
}

export function deveCompactar(input: {
  mensagensNaJanela: number;
  gatilho: number;
  marca: MarcaDaCompactacao;
  temResumoDuravel: boolean;
}): boolean {
  if (input.mensagensNaJanela < input.gatilho) return false;
  if (input.marca.ultima === null || !input.temResumoDuravel) return true;
  return input.marca.novasDesdeEla >= passoDaCompactacao(input.gatilho);
}

export async function lerMarcaDaCompactacao(
  db: pg.Pool,
  ids: { tenantId: string; leadId: string },
): Promise<MarcaDaCompactacao> {
  const { rows } = await db.query<{ ultima: Date | null; novas: string | null }>(
    `with ultima as (
       select max(created_at) as t from llm_calls
        where organization_id = $1 and contact_id = $2 and purpose = 'compaction' and status = 'ok'
     )
     select (select t from ultima) as ultima,
            (select count(*) from messages m
              where m.organization_id = $1 and m.contact_id = $2
                and m.created_at > (select t from ultima)) as novas`,
    [ids.tenantId, ids.leadId],
  );
  const r = rows[0];
  return { ultima: r?.ultima ?? null, novasDesdeEla: Number(r?.novas ?? 0) };
}
