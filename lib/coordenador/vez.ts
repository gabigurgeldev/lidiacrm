/**
 * De quem é a vez quando o turno NÃO nasce de uma mensagem do cliente —
 * follow-up agendado, re-entrada por template, resposta de um caso humano.
 *
 * A entrada (`entrada.ts`) decide sobre o que o cliente disse. Aqui não há o
 * que decidir: a conversa já tem dono, e a pergunta é só se este envio
 * atrapalha quem conduz.
 *
 *   - sem política `active`, ou conversa que o coordenador nunca tocou →
 *     `seguir`: o caminho de antes, sem concessão;
 *   - dono é um agente → `seguir_como_agente`: o envio leva a geração atual e
 *     passa pelo gate `coordenacao` como qualquer fala do dono;
 *   - dono é um fluxo VIVO → `adiar`: o fluxo está no meio de uma etapa com o
 *     cliente, e um follow-up no meio dela é a segunda voz que o coordenador
 *     existe para impedir. Volta depois, com prazo visível no job;
 *   - pessoa no comando ou contato bloqueado → `pular`.
 */
import type { Consulta } from "./banco";
import { lerEstado } from "./estado";
import { carregarPoliticaEfetiva } from "./politica/resolver";

/** Quanto um follow-up espera quando um fluxo está conduzindo. */
export const ESPERA_DO_FOLLOWUP_MS = 15 * 60_000;

export type VezDoTurno =
  | { acao: "seguir" }
  | { acao: "seguir_como_agente"; agentId: string; geracao: number; politicaVersaoId: string }
  | { acao: "adiar"; motivo: "fluxo_conduzindo"; esperaMs: number }
  | { acao: "pular"; motivo: "pessoa_no_comando" | "bloqueado" | "sem_dono" };

export async function vezDoTurnoSemMensagem(
  db: Consulta,
  q: { organizationId: string; conversationId: string; channelSessionId: string | null },
): Promise<VezDoTurno> {
  const politica = await carregarPoliticaEfetiva(db, q.organizationId, q.channelSessionId);
  if (!politica || politica.modo !== "active") return { acao: "seguir" };
  const estado = await lerEstado(db, q.organizationId, q.conversationId);
  if (!estado) return { acao: "seguir" };
  if (estado.situacao === "bloqueado") return { acao: "pular", motivo: "bloqueado" };
  switch (estado.dono_tipo) {
    case "pessoa":
      return { acao: "pular", motivo: "pessoa_no_comando" };
    case "agente":
      return estado.dono_agent_id
        ? {
            acao: "seguir_como_agente",
            agentId: estado.dono_agent_id,
            geracao: estado.geracao,
            politicaVersaoId: politica.versao_id,
          }
        : { acao: "pular", motivo: "sem_dono" };
    case "fluxo": {
      if (!estado.dono_execution_id) return { acao: "seguir" };
      const { rows } = await db.query<{ viva: boolean }>(
        `select status in ('pending', 'running', 'waiting') as viva
           from public.flow_executions where organization_id = $1 and id = $2`,
        [q.organizationId, estado.dono_execution_id],
      );
      // Fluxo que já terminou não conduz nada: o follow-up segue.
      return rows[0]?.viva === true
        ? { acao: "adiar", motivo: "fluxo_conduzindo", esperaMs: ESPERA_DO_FOLLOWUP_MS }
        : { acao: "seguir" };
    }
    default:
      return { acao: "seguir" };
  }
}
