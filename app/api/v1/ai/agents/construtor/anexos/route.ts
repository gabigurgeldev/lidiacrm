/**
 * POST /api/v1/ai/agents/construtor/anexos — "Criar com IA", ler arquivos.
 *
 * Recebe até 5 arquivos (PDF, Markdown ou texto, até 20 MB cada) e devolve o
 * TEXTO de cada um. **Não guarda nada**: nem o arquivo no Storage, nem linha no
 * banco. Quem decide o destino do texto é a tela —
 *  - "a IA lê como contexto": o texto vai junto nas perguntas e na geração;
 *  - "guardar como material": vira um documento na prévia, e só é gravado no
 *    clique final de criar, como todo o resto do construtor.
 *
 * Guardar o arquivo aqui deixaria órfão todo anexo de uma criação abandonada.
 * O preço da escolha: o material guardado é o TEXTO, não o PDF — a tela diz isso.
 *
 * Texto por arquivo é cortado em `TETO_POR_ANEXO` (a prévia e o modelo têm
 * limite); a resposta diz quando cortou.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { TETO_POR_ANEXO } from "@/lib/ai/agents/construtor/esquemas";
import { ErroDeExtracao, extrairTextoDoBuffer, resolverExtensao } from "@/lib/ai/rag/ingest/documento";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const TAMANHO_MAXIMO = 20 * 1024 * 1024;
const MAX_ARQUIVOS = 5;

type Lido =
  | { nome: string; ok: true; texto: string; chars: number; truncado: boolean }
  | { nome: string; ok: false; motivo: string };

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "ai_agents" });
  if (!authz.ok) return authz.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("validation_failed", "Envie os arquivos como formulário (multipart).", 422, { requestId });
  }
  // `FormDataEntryValue` é string ou arquivo. Não `instanceof File`: o File do
  // corpo pode vir de outro realm (undici × global) e o teste daria falso.
  const arquivos = form.getAll("arquivos").filter((f): f is File => typeof f !== "string");
  if (arquivos.length === 0) {
    return fail("validation_failed", "Nenhum arquivo enviado.", 422, { requestId });
  }
  if (arquivos.length > MAX_ARQUIVOS) {
    return fail("validation_failed", `Envie no máximo ${MAX_ARQUIVOS} arquivos de uma vez.`, 422, { requestId });
  }

  const lidos: Lido[] = [];
  for (const arquivo of arquivos) {
    const nome = arquivo.name.slice(0, 120) || "arquivo";
    if (arquivo.size > TAMANHO_MAXIMO) {
      lidos.push({ nome, ok: false, motivo: "passa de 20 MB" });
      continue;
    }
    const extensao = resolverExtensao(arquivo.name, arquivo.type);
    if (!extensao) {
      lidos.push({ nome, ok: false, motivo: "não sei ler esse tipo — envie PDF, Markdown (.md) ou texto (.txt)" });
      continue;
    }
    try {
      const texto = (await extrairTextoDoBuffer(Buffer.from(await arquivo.arrayBuffer()), extensao)).trim();
      lidos.push({
        nome,
        ok: true,
        texto: texto.slice(0, TETO_POR_ANEXO),
        chars: texto.length,
        truncado: texto.length > TETO_POR_ANEXO,
      });
    } catch (err) {
      const motivo = err instanceof ErroDeExtracao ? err.message : "não consegui ler este arquivo";
      if (!(err instanceof ErroDeExtracao)) {
        logger.warn("agent_builder.anexos.falhou", {
          requestId,
          extensao,
          causa: err instanceof Error ? err.message : String(err),
        });
      }
      lidos.push({ nome, ok: false, motivo });
    }
  }

  return ok({ anexos: lidos }, { requestId });
}
