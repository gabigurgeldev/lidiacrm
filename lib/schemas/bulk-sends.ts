/**
 * Contratos de entrada do disparo em massa.
 *
 * Os limites de intervalo vêm de `KNOB_BOUNDS` (`lib/agent-engine/pacing/defaults.ts`),
 * que é a régua do produto inteiro para número de ritmo — e é a MESMA que o
 * CHECK `bulk_sends_interval_check` aplica no banco. Digitar `1000` e `600000`
 * aqui criaria uma terceira régua para divergir das outras duas.
 *
 * ⚠️ Zod não substitui o CHECK do banco: ele transforma 500 em 422, com uma
 * frase que a pessoa entende. Quem garante a coerência é o schema.
 */
import { z } from "zod";

import { KNOB_BOUNDS } from "@/lib/agent-engine/pacing/defaults";
import { MAX_DESTINATARIOS } from "@/lib/bulk-send/montagem";

/** De onde sai a lista. Discriminada: cada caminho pede campos diferentes. */
export const audienciaSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("contacts"),
    contact_ids: z.array(z.string().uuid()).min(1).max(MAX_DESTINATARIOS),
  }),
  z.object({
    kind: z.literal("tags"),
    tags: z.array(z.string().trim().min(1)).min(1).max(20),
  }),
  // O arquivo já foi importado pela rota (multipart); este caminho existe para
  // a tela poder mandar os ids resolvidos de volta na confirmação.
  z.object({
    kind: z.literal("file"),
    contact_ids: z.array(z.string().uuid()).min(1).max(MAX_DESTINATARIOS),
  }),
]);

export const criarDisparoSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    channel_session_id: z.string().uuid(),
    mode: z.enum(["freeform", "template"]),
    body: z.string().trim().min(1).max(4096).optional(),
    template_name: z.string().trim().min(1).max(200).optional(),
    template_language: z.string().trim().min(2).max(20).optional(),
    template_values: z.record(z.string(), z.string()).default({}),
    interval_ms: z
      .number()
      .int()
      .min(KNOB_BOUNDS.intervalMinMs)
      .max(KNOB_BOUNDS.intervalMaxMs)
      .default(5_000),
    /** ISO-8601. Ausente = começa ao dar start. */
    scheduled_for: z.string().datetime().optional(),
    audiencia: audienciaSchema,
  })
  // Espelha `bulk_sends_modo_x_conteudo_check`. Sem isto o Postgres recusaria a
  // linha com a mensagem crua da constraint, que não diz o que fazer.
  .superRefine((v, ctx) => {
    if (v.mode === "freeform" && !v.body) {
      ctx.addIssue({
        code: "custom",
        path: ["body"],
        message: "Escreva o texto da mensagem.",
      });
    }
    if (v.mode === "template" && (!v.template_name || !v.template_language)) {
      ctx.addIssue({
        code: "custom",
        path: ["template_name"],
        message: "Escolha o modelo aprovado e o idioma dele.",
      });
    }
  });

export type CriarDisparoInput = z.infer<typeof criarDisparoSchema>;

/** `start` aceita reagendar na hora de disparar — é a última chance de mudar. */
export const iniciarDisparoSchema = z.object({
  scheduled_for: z.string().datetime().optional(),
});

export const listarDestinatariosSchema = z.object({
  status: z.enum(["pending", "sending", "sent", "failed", "skipped"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  cursor: z.string().optional(),
});
