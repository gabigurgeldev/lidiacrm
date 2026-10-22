/**
 * As FORMAS dos corpos e da query de `/api/v1/agenda/agendamentos`.
 *
 * Fora de `route.ts` porque um arquivo de rota do App Router só exporta verbos
 * e opções de segmento — e os testes precisam importar estes schemas.
 */
import { z } from "zod";

export const listarSchema = z.object({
  contact_id: z.string().uuid().optional(),
  lead_id: z.string().uuid().optional(),
  owner_user_id: z.string().uuid().optional(),
  /** A agenda de UMA profissional — como principal ou como apoio. */
  professional_id: z.string().uuid().optional(),
  dia: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  de: z.string().datetime({ offset: true }).optional(),
  ate: z.string().datetime({ offset: true }).optional(),
  situacao: z.enum(["pending", "confirmed", "cancelled", "completed", "no_show"]).optional(),
  limite: z.coerce.number().int().min(1).max(500).optional(),
});

/**
 * O corpo de marcar — a forma de `MarcarInput` (`lib/agenda/contrato.ts`).
 *
 * `professional_ids`: 1 ou 2, a primeira é a principal; ausente = a 1ª opção
 * livre do instante. A quantidade EXATA (a que o tipo pede) é regra do handler,
 * que conhece o tipo — aqui só a forma. `owner_user_id` é LEGADO.
 */
export const marcarSchema = z.object({
  event_type_id: z.string().uuid(),
  starts_at: z.string().datetime({ offset: true }),
  professional_ids: z.array(z.string().uuid()).min(1).max(2).optional(),
  owner_user_id: z.string().uuid().optional(),
  contact_id: z.string().uuid().optional(),
  /** A conversa de onde a marcação veio — é por ela que sai o lembrete. */
  conversation_id: z.string().uuid().optional(),
  title: z.string().min(1).max(200).optional(),
  notes: z.string().max(2000).optional(),
});

export const alterarSchema = z
  .object({
    id: z.string().uuid(),
    /** Remarcar: o novo início. A duração vem do tipo, como na criação. */
    starts_at: z.string().datetime({ offset: true }).optional(),
    /**
     * `rescheduled` NÃO entra aqui: remarcar se pede mandando `starts_at`, e é
     * movimento próprio — não uma situação que se escolhe.
     */
    status: z.enum(["confirmed", "completed", "no_show"]).optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine((c) => c.starts_at !== undefined || c.status !== undefined || c.notes !== undefined, {
    message: "Informe pelo menos um campo para alterar.",
  });

export const cancelarSchema = z.object({
  id: z.string().uuid(),
  /**
   * ⚠️ OBRIGATÓRIO, e não é burocracia: é o que a equipe lê ao ver o horário
   * vago. "Cancelado" sem motivo faz alguém ligar para o cliente perguntando o
   * que houve — ou, pior, não ligar.
   */
  reason: z.string().min(3).max(500),
});
