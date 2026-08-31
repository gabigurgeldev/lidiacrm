/**
 * POST /api/v1/contacts/import — importa contatos de planilha CSV.
 *
 * Formato aceito: CSV RFC 4180 com linha de cabeçalho (delimitador detectado
 * automaticamente entre vírgula, ponto-e-vírgula e tabulação — Excel pt-BR
 * exporta ";"). Colunas reconhecidas e apelidos em `lib/contacts/csv.ts`.
 * XLSX é recusado na borda com instrução de exportar como CSV.
 *
 * A REGRA não mora mais aqui: mora em `lib/contacts/importar.ts`, porque o
 * disparo em massa importa a mesma planilha e não pode ter uma segunda cópia
 * (a diferença que o disparo precisava era devolver o ID de quem JÁ existia —
 * numa campanha, o contato que já está na base é justamente quem mais deve
 * receber). Esta rota ficou sendo o que uma rota deve ser: borda, auditoria e
 * resposta. O desfecho que ela devolve é byte a byte o de antes.
 *
 * Desfecho POR LINHA, nunca do lote inteiro:
 *   - linha inválida é pulada com motivo nominal (vem no response);
 *   - contato que já existe (telefone/e-mail/CPF da org) é contado como
 *     duplicado, não como erro;
 *   - as demais linhas seguem mesmo se uma falhar — uma planilha de 400 nomes
 *     não pode morrer inteira pelo telefone malformado da linha 7.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { audit } from "@/lib/audit";
import { CSV_MAX_BYTES } from "@/lib/contacts/csv";
import { importarLinhas, prepararLinhas, recusaDeFormato } from "@/lib/contacts/importar";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supabase = await createClient();
  // spec 13 §4: escrita é agent+ (viewer é read-only), igual ao POST unitário.
  const authz = await requireRole("agent", { requestId, resource: "contacts" });
  if (!authz.ok) return authz.response;
  const user = authz.user;
  const orgId = authz.org.orgId;

  let file: File;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (!(f instanceof File)) throw new Error("sem arquivo");
    file = f;
  } catch {
    return fail("validation_failed", "Envie o arquivo como multipart/form-data no campo 'file'.", 422, {
      requestId,
    });
  }

  const recusa = recusaDeFormato(file.name ?? "", file.type);
  if (recusa) return fail("validation_failed", recusa, 422, { requestId });

  if (file.size > CSV_MAX_BYTES) {
    return fail("validation_failed", `Arquivo maior que ${Math.floor(CSV_MAX_BYTES / 1024 / 1024)}MB.`, 413, {
      requestId,
    });
  }

  const preparado = prepararLinhas(await file.text());
  if (preparado.erro !== null) {
    return fail("validation_failed", preparado.erro, 422, {
      requestId,
      ...(preparado.detalhe ? { details: preparado.detalhe } : {}),
    });
  }

  const { resumo } = await importarLinhas(supabase, {
    organizationId: orgId,
    userId: user.id,
    indices: preparado.indices,
    dataRows: preparado.dataRows,
    requestId,
  });

  await audit({
    action: "contacts.imported",
    actorUserId: user.id,
    organizationId: orgId,
    resourceType: "contact",
    resourceId: null,
    requestId,
    metadata: {
      actor_type: "user",
      total_linhas: resumo.total_linhas,
      imported: resumo.imported,
      skipped_duplicates: resumo.skipped_duplicates,
      erros: resumo.errors.length,
    },
  });

  return ok(resumo, { requestId });
}
