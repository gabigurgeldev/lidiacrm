/**
 * UM FLUXO DE TRIAGEM ESTÁ CONVERSANDO COM ESTE CLIENTE? (migration 0228)
 *
 * Com o gatilho "Quando o cliente manda mensagem" marcado para silenciar a IA,
 * o fluxo faz as perguntas (nome, sistema, problema) e o agente não pode
 * responder por cima — cada mensagem do cliente arma o turno do agente E acorda
 * o fluxo, em paralelo.
 *
 * CALCULADO na hora, não gravado: nenhuma trava a desfazer quando o fluxo
 * termina, morre, é cancelado ou republicado. Cobre três casos:
 *   1. há execução `silencia_ia` VIVA do contato;
 *   2. a mensagem do turno é a que ARMOU a execução (o fluxo pode ter terminado
 *      antes do turno, que espera o debounce);
 *   3. a mensagem chegou DURANTE uma execução que já terminou — é a resposta ao
 *      último menu, e o fluxo terminou 2s depois; sem este caso o agente
 *      responderia a ela por cima da passagem que o próprio fluxo fez.
 *
 * Gêmeo supabase-js para o worker legado em `fluxoNoComandoCrm`.
 */
import type pg from 'pg';

export async function fluxoNoComando(
  db: pg.Pool,
  tenantId: string,
  contactId: string,
  inboundMessageId: string | null,
): Promise<{ execucaoId: string } | null> {
  const { rows } = await db.query<{ id: string }>(
    `select e.id
       from flow_executions e
       left join messages m
         on m.organization_id = e.organization_id and m.id = $3::uuid
      where e.organization_id = $1
        and e.contact_id = $2
        and e.silencia_ia
        and (
          e.status in ('pending','running','waiting')
          or ($3::uuid is not null and e.input->>'message_id' = $3::text)
          or (m.id is not null
              and e.started_at <= m.created_at
              and coalesce(e.completed_at, e.updated_at) >= m.created_at)
        )
      order by e.started_at desc
      limit 1`,
    [tenantId, contactId, inboundMessageId],
  );
  const id = rows[0]?.id;
  return id === undefined ? null : { execucaoId: id };
}
