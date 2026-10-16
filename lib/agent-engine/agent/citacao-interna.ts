/**
 * Citação INTERNA da fonte — o que sustentou cada mensagem do agente, gravado
 * para o ATENDENTE ver na Caixa de entrada ("Fonte: Tabela de preços 2026,
 * trecho 3"). Nunca vai ao cliente.
 *
 * ═══ O QUE ESTAVA ERRADO ═══
 *
 * As citações de uma busca eram SUBSTITUÍDAS pela busca seguinte e anexadas só
 * à PRIMEIRA mensagem enviada depois dela — e só se o desfecho fosse `sent`.
 * Turno com duas buscas perdia a primeira; resposta partida em três bolhas
 * mostrava a fonte na primeira e "nada" nas outras duas; envio enfileirado não
 * guardava nada. E a mensagem do agente sem busca não ganhava nem a marca
 * `ai_generated`, então a tela não tinha como dizer "esta não usou o material".
 *
 * ═══ A REGRA ═══
 *
 * - As citações ACUMULAM no turno (sem repetir trecho) e cada mensagem enviada
 *   leva todas as que existiam quando ela saiu.
 * - Toda mensagem do agente leva `ai_generated: true`.
 * - Mensagem que afirma fato da empresa (mesmo detector do gate de
 *   fundamentação) sem nenhum trecho leva `sem_fonte: true`. Não é acusação de
 *   invenção — a afirmação pode ter vindo das instruções ou de uma ferramenta,
 *   que o gate aceita como fonte —, é o sinal para o atendente conferir.
 * - O número do trecho (`trecho`, a partir de 1) vem de `ai_chunks.position`,
 *   resolvido no próprio UPDATE: uma ida ao banco por mensagem, como antes.
 *
 * Falha aqui só loga: citação é enriquecimento do registro, não condição do
 * envio — a mensagem já saiu.
 */
import type { Citation } from '@/lib/ai/citations/types';

import { detectarAfirmacaoFactual } from '../guardrails/grounding';
import type { Logger } from '../obs/logger';
import type { Queryable } from '../queue/queue';

/** Soma as citações de uma busca às do turno, sem repetir o mesmo trecho. */
export function acumularCitacoes(doTurno: readonly Citation[], novas: readonly Citation[]): Citation[] {
  const vistos = new Set(doTurno.map((c) => c.chunk_id).filter((id): id is string => typeof id === 'string'));
  const saida = [...doTurno];
  for (const c of novas) {
    if (typeof c.chunk_id === 'string') {
      if (vistos.has(c.chunk_id)) continue;
      vistos.add(c.chunk_id);
    }
    saida.push(c);
  }
  return saida;
}

/** A mensagem afirma fato da empresa sem nenhum trecho do material no turno? */
export function semFonteNaMensagem(body: string, citacoes: readonly Citation[]): boolean {
  return citacoes.length === 0 && detectarAfirmacaoFactual(body).length > 0;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function anexarCitacoes(
  db: Queryable,
  ids: { tenantId: string; messageId: string },
  input: { body: string; citacoes: readonly Citation[] },
  log: Logger,
): Promise<void> {
  // Só mensagem de verdade tem linha em `messages`. O canal do ensaio devolve
  // `ensaio-<job>-<seq>`, e comparar isso com a coluna uuid é ERRO de banco —
  // que, dentro da transação do ensaio, aborta tudo o que vem depois, mesmo com
  // o `catch` abaixo. Medido no `test:db` (ensaio-nao-deixa-rastro).
  if (!UUID.test(ids.messageId)) return;
  try {
    await db.query(
      `update messages m
          set metadata = coalesce(m.metadata, '{}'::jsonb) || jsonb_build_object(
                'ai_generated', true,
                'sem_fonte', $4::boolean,
                'citations', coalesce((
                  select jsonb_agg(
                           case when ch.id is null then c.value
                                else c.value || jsonb_build_object('trecho', ch.position + 1)
                           end
                           order by c.ordinality)
                    from jsonb_array_elements($3::jsonb) with ordinality as c(value, ordinality)
                    left join ai_chunks ch
                      on ch.organization_id = $1
                     and ch.id::text = c.value->>'chunk_id'
                ), '[]'::jsonb))
        where m.organization_id = $1
          and m.id = $2`,
      [ids.tenantId, ids.messageId, JSON.stringify(input.citacoes), semFonteNaMensagem(input.body, input.citacoes)],
    );
  } catch (err) {
    log.warn('citações não anexadas à outbound', {
      message_id: ids.messageId,
      error: (err instanceof Error ? err.message : String(err)).slice(0, 120),
    });
  }
}
