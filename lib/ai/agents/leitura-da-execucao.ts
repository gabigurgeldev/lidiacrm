/**
 * Como a aba Execuções diz o que aconteceu num atendimento — em português, com
 * o motivo, em vez do `status` cru da tabela (`completed`, `aborted`).
 *
 * O vocabulário de `abort_reason` é o do motor (`MotivoDoTurno` em
 * `lib/agent-engine/agent/registro-do-turno.ts`); linhas antigas, gravadas pelo
 * runtime legado, podem trazer outros valores, e caem no rótulo do status.
 */

export type TomDaExecucao = "ok" | "atencao" | "erro";

export interface ExecucaoLegivel {
  rotulo: string;
  tom: TomDaExecucao;
}

export function lerExecucao(status: string, abortReason: string | null): ExecucaoLegivel {
  switch (status) {
    case "completed":
      return abortReason === "limite_do_turno"
        ? { rotulo: "Respondeu, cortado pelo limite", tom: "atencao" }
        : { rotulo: "Respondeu", tom: "ok" };
    case "handoff":
      return { rotulo: "Passou para uma pessoa", tom: "atencao" };
    case "failed":
      return { rotulo: "Falhou", tom: "erro" };
    case "aborted":
      switch (abortReason) {
        case "fora_do_horario":
          return { rotulo: "Adiado: fora do horário", tom: "atencao" };
        case "sem_resposta":
          return { rotulo: "Ficou sem resposta", tom: "erro" };
        case "limite_do_turno":
          return { rotulo: "Cortado pelo limite, sem resposta", tom: "erro" };
        case "adiado":
          return { rotulo: "Adiado", tom: "atencao" };
        default:
          return { rotulo: "Interrompido", tom: "erro" };
      }
    case "running":
    case "pending":
      return { rotulo: "Em andamento", tom: "atencao" };
    default:
      return { rotulo: status, tom: "atencao" };
  }
}
