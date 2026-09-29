import { z } from "zod";

/**
 * Configuração da mensagem de aniversário — `organizations.settings.aniversario`.
 *
 * `modo` é o da CONEXÃO escolhida (`freeform` = QR, aceita texto livre;
 * `template` = API oficial, só modelo aprovado), gravado junto para o cron não
 * precisar adivinhar qual conteúdo usar. Quem confere que ele bate com a
 * conexão de verdade é `criarDisparo` (`recusaDeModo`) — a regra fica num
 * lugar só.
 *
 * `{{primeiro_nome}}` e `{{nome}}` valem no texto e nos valores do modelo:
 * o disparo interpola por destinatário (`lib/bulk-send/enviar.ts`).
 */
export const MENSAGEM_PADRAO_DE_ANIVERSARIO =
  "Oi, {{primeiro_nome}}! 🎉 Hoje é o seu dia e a nossa equipe passou aqui para desejar um feliz aniversário, com muita saúde e alegria. Um grande abraço!";

export const HORA_MINIMA = 7;
export const HORA_MAXIMA = 21;

export const modeloDeAniversarioSchema = z.object({
  nome: z.string().trim().min(1).max(200),
  idioma: z.string().trim().min(2).max(20),
  valores: z.record(z.string(), z.string().max(1024)).default({}),
});

export const aniversarioConfigSchema = z.object({
  ativo: z.boolean().default(false),
  canal_id: z.string().uuid().nullable().default(null),
  modo: z.enum(["freeform", "template"]).nullable().default(null),
  hora: z.number().int().min(HORA_MINIMA).max(HORA_MAXIMA).default(9),
  mensagem: z.string().max(4096).default(MENSAGEM_PADRAO_DE_ANIVERSARIO),
  modelo: modeloDeAniversarioSchema.nullable().default(null),
});

export type AniversarioConfig = z.infer<typeof aniversarioConfigSchema>;

export const CONFIG_PADRAO_DE_ANIVERSARIO: AniversarioConfig = aniversarioConfigSchema.parse({});

/** Lê do `settings` cru; jsonb velho ou corrompido vira o padrão (desligado). */
export function lerConfigDeAniversario(settings: unknown): AniversarioConfig {
  const bruto = (settings as { aniversario?: unknown } | null)?.aniversario;
  const r = aniversarioConfigSchema.safeParse(bruto ?? {});
  return r.success ? r.data : CONFIG_PADRAO_DE_ANIVERSARIO;
}

/**
 * O que precisa estar certo para LIGAR. Desligar sempre pode — é a saída de
 * emergência, e não pode depender de uma conexão que talvez nem exista mais.
 */
export const salvarAniversarioSchema = aniversarioConfigSchema.superRefine((v, ctx) => {
  if (!v.ativo) return;
  if (!v.canal_id) {
    ctx.addIssue({ code: "custom", path: ["canal_id"], message: "Escolha por qual conexão a mensagem sai." });
  }
  if (v.modo === "freeform" && v.mensagem.trim().length === 0) {
    ctx.addIssue({ code: "custom", path: ["mensagem"], message: "Escreva a mensagem de aniversário." });
  }
  if (v.modo === "template" && !v.modelo) {
    ctx.addIssue({
      code: "custom",
      path: ["modelo"],
      message: "A API oficial só envia modelo aprovado. Escolha o modelo de aniversário.",
    });
  }
  if (!v.modo) {
    ctx.addIssue({ code: "custom", path: ["modo"], message: "Escolha a conexão de novo." });
  }
});
