import { z } from "zod";

/**
 * Telefone do aviso ao atendente. A pessoa digita como fala ("11 98765-4321",
 * "+55 (11) 98765-4321"); o banco guarda E.164 — mesma régua de
 * `attendant_availability.notification_phone`. Sem DDI, assume Brasil: é o
 * caso de quase toda instalação, e errar o DDI manda o aviso para outro país.
 */
export const telefoneDoAvisoSchema = z
  .string()
  .trim()
  .transform((v) => {
    const digitos = v.replace(/\D/g, "");
    if (v.startsWith("+")) return `+${digitos}`;
    return digitos.length <= 11 ? `+55${digitos}` : `+${digitos}`;
  })
  .pipe(z.string().regex(/^\+[0-9]{8,15}$/, "Telefone inválido."));

/** O que a tela manda para marcar uma mensagem. */
export const criarMensagemAgendadaSchema = z.object({
  body: z.string().trim().min(1, "Escreva a mensagem.").max(4096),
  /** ISO-8601 com fuso. A validação de "no futuro" é da rota, que sabe o agora. */
  scheduled_for: z.string().datetime({ offset: true }),
  channel_session_id: z.string().uuid(),
  notify: z
    .object({
      phone: telefoneDoAvisoSchema,
      body: z.string().trim().min(1, "Escreva o aviso.").max(4096),
    })
    .optional(),
});

export type CriarMensagemAgendada = z.infer<typeof criarMensagemAgendadaSchema>;

/** Até quando se pode marcar. Um ano cobre "lembrar da renovação anual". */
export const HORIZONTE_MAXIMO_MS = 366 * 24 * 3600_000;

export const STATUS_DA_MENSAGEM_AGENDADA = [
  "scheduled",
  "sending",
  "sent",
  "queued",
  "failed",
  "cancelled",
] as const;
export type StatusDaMensagemAgendada = (typeof STATUS_DA_MENSAGEM_AGENDADA)[number];

/** Linha como a API devolve. */
export interface MensagemAgendada {
  id: string;
  conversation_id: string;
  channel_session_id: string;
  body: string;
  scheduled_for: string;
  notify_phone: string | null;
  notify_body: string | null;
  status: StatusDaMensagemAgendada;
  failure_reason: string | null;
  created_by_user_id: string | null;
  created_at: string;
  sent_at: string | null;
}
