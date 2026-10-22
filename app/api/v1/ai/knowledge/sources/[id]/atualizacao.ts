/**
 * O que o PATCH de um material grava na linha — ou por que recusa.
 *
 * Mora fora do `route.ts` porque o Next recusa export que não seja handler num
 * arquivo de rota, e esta regra precisa de teste próprio: é a primeira das três
 * travas que protegem o envio de foto (as outras duas são
 * `caminhoDeMaterialValido` na leitura e no envio).
 *
 * Para material `imagem`:
 *  - `source_metadata` vindo do corpo é RECUSADO. Sem isto, um PATCH trocaria
 *    `blob_path` por um arquivo qualquer do bucket — e quem assina a URL é a
 *    service role;
 *  - `descricao` entra MESCLADA sobre o `source_metadata` que já está no banco,
 *    preservando `blob_path`, `mime_type` e o resto.
 */

import { z } from "zod";

import { DESCRICAO_DA_FOTO_MAX, DESCRICAO_DA_FOTO_MIN } from "@/lib/ai/rag/imagem";
import type { TipoDeFonteId } from "@/lib/ai/rag/tipos-de-fonte";

const faqItemSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
  tags: z.array(z.string()).optional().default([]),
  locale: z.string().optional().default("pt-BR"),
});

export const patchSourceSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  items: z.array(faqItemSchema).optional(),
  source_metadata: z.record(z.string(), z.unknown()).optional(),
  /** Só para material do tipo `imagem`: a descrição que o agente busca. */
  descricao: z.string().trim().min(DESCRICAO_DA_FOTO_MIN).max(DESCRICAO_DA_FOTO_MAX).optional(),
});

export type PatchDeMaterial = z.infer<typeof patchSourceSchema>;

export type Atualizacao =
  | { ok: true; campos: Record<string, unknown> }
  | { ok: false; mensagem: string };

export function montarAtualizacao(
  input: PatchDeMaterial,
  existente: { tipo: TipoDeFonteId | null; source_metadata: Record<string, unknown> | null },
): Atualizacao {
  const campos: Record<string, unknown> = {};
  if (input.name !== undefined) campos.name = input.name;

  if (existente.tipo === "imagem") {
    if (input.source_metadata !== undefined) {
      return {
        ok: false,
        mensagem:
          "Os dados de uma foto não se editam por aqui — para trocar a imagem, envie outra foto. " +
          "A descrição se edita pelo campo 'descricao'.",
      };
    }
    if (input.descricao !== undefined) {
      campos.source_metadata = { ...(existente.source_metadata ?? {}), descricao: input.descricao };
    }
    return { ok: true, campos };
  }

  // Descrição mandada para quem não é foto seria descartada em silêncio — o
  // mesmo defeito dos itens de FAQ mandados para documento.
  if (input.descricao !== undefined) {
    return { ok: false, mensagem: "Só material do tipo foto tem descrição editável." };
  }
  if (input.source_metadata !== undefined) campos.source_metadata = input.source_metadata;
  return { ok: true, campos };
}
