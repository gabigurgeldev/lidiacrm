/**
 * As FORMAS dos corpos de `/api/v1/agenda/profissionais` e das folgas.
 *
 * Fora de `route.ts` porque um arquivo de rota do App Router só exporta verbos
 * e opções de segmento — e os testes precisam importar estes schemas.
 *
 * Os limites são os MESMOS dos CHECKs da migration 0245
 * (`calendar_professionals_nome_valido`, `_trilha_valida`) e da 0177
 * (`calendar_exceptions_faixa_valida`): a constraint é a verdade, e a validação
 * aqui transforma o 500 dela numa recusa 422 que diz o que está fora.
 */
import { z } from "zod";

import { availabilityScheduleSchema } from "@/lib/schemas/routing";

/** A jornada semanal — o MESMO shape de `attendant_availability.schedule`. */
export const jornadaSchema = availabilityScheduleSchema;

const nome = z.string().trim().min(1).max(120);
const trilha = z.number().int().min(1).max(8);
/** Os serviços (tipos de agendamento) que ela atende — substitui o conjunto inteiro. */
const tipos = z.array(z.string().uuid()).max(200);

export const criarProfissionalSchema = z.object({
  nome,
  trilha: trilha.nullish(),
  /** Vincular a um membro da equipe (opcional — profissional SEM login é o caso comum). */
  user_id: z.string().uuid().nullish(),
  jornada: jornadaSchema.nullish(),
  tipos: tipos.optional(),
});
export type CriarProfissional = z.infer<typeof criarProfissionalSchema>;

export const alterarProfissionalSchema = z
  .object({
    nome: nome.optional(),
    trilha: trilha.nullable().optional(),
    ativo: z.boolean().optional(),
    /**
     * Só VINCULA (de nenhum membro para um). Desvincular não existe: o
     * backfill do `update.sh` recria o profissional de todo membro com agenda, e
     * a pessoa ganharia uma segunda linha. Trocar de membro também é recusado
     * pela rota — é outra pessoa, e o histórico dela não se transfere.
     */
    user_id: z.string().uuid().nullable().optional(),
    jornada: jornadaSchema.nullable().optional(),
    tipos: tipos.optional(),
  })
  .refine((v) => v.user_id !== null, {
    message: "Uma profissional vinculada a um membro não pode ser desvinculada. Desative-a em vez disso.",
    path: ["user_id"],
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "Informe pelo menos um campo para alterar.",
  });
export type AlterarProfissional = z.infer<typeof alterarProfissionalSchema>;

/** `YYYY-MM-DD` que é uma data de verdade (sem 2026-02-30). */
const dataISO = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "data no formato AAAA-MM-DD")
  .refine((d) => {
    const t = Date.parse(`${d}T00:00:00Z`);
    return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
  }, "data inexistente");

const minuto = z.number().int().min(0).max(1440);

export const criarFolgaSchema = z
  .object({
    /** No fuso da jornada dela — o mesmo da coluna `exception_date`. */
    data: dataISO,
    /** `true` tira horas da jornada (o caso comum); `false` ABRE horas fora dela. */
    indisponivel: z.boolean().default(true),
    /** Minutos desde a meia-noite; os dois ausentes = o dia inteiro. */
    inicio_minuto: minuto.nullish(),
    fim_minuto: minuto.nullish(),
    motivo: z.string().trim().max(200).nullish(),
  })
  .refine((f) => (f.inicio_minuto == null) === (f.fim_minuto == null), {
    message: "Informe início e fim juntos, ou nenhum dos dois para o dia inteiro.",
    path: ["fim_minuto"],
  })
  .refine((f) => f.inicio_minuto == null || f.fim_minuto == null || f.fim_minuto > f.inicio_minuto, {
    message: "O fim precisa ser depois do início.",
    path: ["fim_minuto"],
  });
export type CriarFolga = z.infer<typeof criarFolgaSchema>;

export const removerFolgaSchema = z.object({ id: z.string().uuid() });
