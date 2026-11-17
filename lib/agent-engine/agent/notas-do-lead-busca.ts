/**
 * BUSCA NAS NOTAS DO LEAD POR ASSUNTO — ferramenta `buscar_notas_do_lead`.
 *
 * O índice de notas (headline + id) entra no prompt e o corpo é lido nota a
 * nota com `get_lead_note`. Com muitas notas, o modelo abre a errada ou abre
 * várias. Aqui ele pergunta pelo assunto e recebe as notas mais ligadas, já com
 * o corpo.
 *
 * Ordem: o rerank da OpenRouter (ponto `notas`) lê pergunta × nota. Sem chave,
 * ou se o rerank falhar, a ordem é a do `ts_rank` da config `simple` (preserva
 * código de pedido e valor), com a nota mais recente desempatando.
 *
 * Não usa `recallLeadNotes`: aquele recall pede embedding por nota (chamada
 * externa paga + escrita em `lead_notes.embedding`), e as notas de um lead são
 * poucas por construção — o orçamento do índice é imposto na escrita. Para
 * dezenas de documentos curtos, o rerank direto é mais preciso e mais barato.
 *
 * Isolamento: (organization_id, contact_id) vêm do runtime, nunca do modelo.
 */
import { reordenarItens, type DepsDoRerank } from '@/lib/ai/rerank/openrouter';

import type { Queryable } from '../queue/queue';

/** Quantas notas o banco devolve para o rerank escolher. */
export const CANDIDATOS_DE_NOTA = 40;
/** Quantas notas voltam ao modelo, com corpo. */
export const NOTAS_DEVOLVIDAS = 5;

export interface NotaEncontrada {
  id: string;
  headline: string;
  body: string;
  /** Relevância do rerank; `null` quando a ordem é do `ts_rank`. */
  relevancia: number | null;
}

export async function buscarNotasDoLead(
  db: Queryable,
  ids: { tenantId: string; leadId: string },
  pergunta: string,
  deps?: { rerank?: DepsDoRerank },
): Promise<{ notas: NotaEncontrada[]; reordenado: boolean }> {
  const { rows } = await db.query<{ id: string; headline: string; body: string }>(
    `select id, headline, body
       from lead_notes
      where organization_id = $1 and contact_id = $2
      order by ts_rank(
                 to_tsvector('simple', headline || ' ' || body),
                 websearch_to_tsquery('simple', $3)
               ) desc,
               created_at desc, id
      limit $4`,
    [ids.tenantId, ids.leadId, pergunta, CANDIDATOS_DE_NOTA],
  );
  if (rows.length === 0) return { notas: [], reordenado: false };

  const { itens, reordenado } = await reordenarItens(
    {
      organizationId: ids.tenantId,
      query: pergunta,
      itens: rows,
      texto: (n) => `${n.headline}\n${n.body}`.slice(0, 1_000),
      topN: NOTAS_DEVOLVIDAS,
      ponto: 'notas',
    },
    deps?.rerank,
  );
  return {
    notas: itens.map((n) => ({ id: n.id, headline: n.headline, body: n.body, relevancia: n.relevancia })),
    reordenado,
  };
}
