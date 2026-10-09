/**
 * O vigia do coordenador — o mecanismo anti-morte.
 *
 * Duas coisas que nada mais recupera:
 *
 *   1. CHAMADA VENCIDA. Um fluxo chamado com retorno que não termina deixaria
 *      o agente que chamou esperando para sempre. Passado o prazo, o vigia
 *      CANCELA a execução — e o trigger `fn_coord_fluxo_terminou` faz o resto
 *      pela porta de sempre: fecha a chamada e devolve a conversa a quem
 *      chamou, com o turno dele no outbox. Depois marca a chamada `expirou`,
 *      para a atividade dizer o que de fato aconteceu.
 *
 *   2. CONVERSA PRESA. Política ativa, a conversa sem fluxo nem pessoa
 *      conduzindo, e mensagem do cliente sem resposta e sem admissão há mais
 *      de 10 minutos: o turno morreu, ou o coordenador não achou destino
 *      seguro. Abre UM aviso na Central por conversa (`coordenador_preso`),
 *      e não responde no lugar de ninguém: escolher quem fala é exatamente o
 *      que deu errado.
 *
 * Roda no worker, no ritmo do reaper. Lotes pequenos: o vigia não pode virar a
 * carga que ele vigia.
 */
import type { Consulta } from "./banco";
import { carregarPoliticaEfetiva } from "./politica/resolver";

export const ESPERA_ANTES_DE_PRESA_MIN = 10;
const LOTE = 50;

export interface ResultadoDoVigia {
  expiradas: number;
  presas: number;
}

/** Abre o aviso na Central; `false` = já havia um aberto para esta conversa. */
type InserirAviso = (organizationId: string, aviso: { conversationId: string; motivo: string }) => Promise<boolean>;

async function expirarChamadas(db: Consulta): Promise<number> {
  const { rows } = await db.query<{ id: string; organization_id: string; destino_execution_id: string | null }>(
    `select id, organization_id, destino_execution_id
       from public.coord_chamadas
      where status in ('pendente', 'ativa') and prazo < now()
      order by prazo asc
      limit ${LOTE}`,
  );
  for (const c of rows) {
    if (c.destino_execution_id !== null) {
      // O trigger de término fecha a chamada como `cancelada` e devolve a
      // conversa a quem chamou, se a modalidade for retorno.
      await db.query(
        `update public.flow_executions
            set status = 'cancelled', next_eval_at = null, claimed_until = null,
                completed_at = now(), last_error = 'coord_chamada_expirou', updated_at = now()
          where organization_id = $1 and id = $2 and status in ('pending', 'running', 'waiting', 'paused')`,
        [c.organization_id, c.destino_execution_id],
      );
    }
    await db.query(
      `update public.coord_chamadas
          set status = 'expirou', motivo_fim = 'prazo_vencido',
              concluida_em = coalesce(concluida_em, now()), updated_at = now()
        where organization_id = $1 and id = $2 and status in ('pendente', 'ativa', 'cancelada')`,
      [c.organization_id, c.id],
    );
  }
  return rows.length;
}

async function acharPresas(db: Consulta): Promise<{ organization_id: string; conversation_id: string; channel_session_id: string | null; dono_tipo: string }[]> {
  const { rows } = await db.query<{
    organization_id: string;
    conversation_id: string;
    channel_session_id: string | null;
    dono_tipo: string;
  }>(
    `select s.organization_id, s.conversation_id, c.channel_session_id, s.dono_tipo
       from public.coord_estado_conversa s
       join public.conversations c on c.id = s.conversation_id and c.organization_id = s.organization_id
      where s.dono_tipo in ('nenhum', 'agente')
        and s.situacao <> 'bloqueado'
        and exists (
          select 1 from public.messages m
           where m.organization_id = s.organization_id and m.conversation_id = s.conversation_id
             and m.direction = 'inbound'
             and m.created_at < now() - make_interval(mins => ${ESPERA_ANTES_DE_PRESA_MIN})
             and m.created_at > now() - interval '2 days'
             and m.sent_at > coalesce((
                   select max(o.sent_at) from public.messages o
                    where o.organization_id = s.organization_id and o.conversation_id = s.conversation_id
                      and o.direction = 'outbound'
                 ), '-infinity'::timestamptz)
             and not exists (
               select 1 from public.coord_admissoes a
                where a.organization_id = m.organization_id and a.message_id = m.id
             )
        )
      limit ${LOTE}`,
  );
  return rows;
}

export async function vigiarCoordenador(db: Consulta, avisar: InserirAviso): Promise<ResultadoDoVigia> {
  const expiradas = await expirarChamadas(db);

  let presas = 0;
  // A política é por número: só conversa de número com coordenador ATIVO conta.
  // Em shadow nada é admitido, e toda conversa pareceria presa.
  const ativa = new Map<string, boolean>();
  for (const p of await acharPresas(db)) {
    const chave = `${p.organization_id}:${p.channel_session_id ?? ""}`;
    if (!ativa.has(chave)) {
      const politica = await carregarPoliticaEfetiva(db, p.organization_id, p.channel_session_id);
      ativa.set(chave, politica?.modo === "active");
    }
    if (!ativa.get(chave)) continue;
    const aberto = await avisar(p.organization_id, {
      conversationId: p.conversation_id,
      motivo: p.dono_tipo === "nenhum" ? "sem_destino_seguro" : "turno_nao_respondeu",
    });
    if (aberto) presas += 1;
  }
  return { expiradas, presas };
}
