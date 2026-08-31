/**
 * POST /api/v1/bulk-sends/importar-lista — a planilha vira lista de destinatários.
 *
 * ═══ Por que uma rota, e não reusar `/contacts/import` ═══
 *
 * Porque as duas respondem perguntas diferentes. Aquela responde "quantos criei"
 * — e para ela o contato que JÁ existia é um duplicado a contar e seguir. Esta
 * responde "com quem eu vou falar", e nela o contato que já está na base é
 * justamente quem mais deve receber a campanha.
 *
 * A REGRA é a mesma (`lib/contacts/importar.ts`, extraído da outra rota
 * exatamente para isto). O que muda é o que se devolve: aqui saem os ids de
 * TODOS os resolvidos, criados e já existentes, mais o recorte das guardas —
 * que é o número honesto que a tela de confirmação mostra antes de o operador
 * apertar o botão.
 *
 * ═══ O que esta rota NÃO faz ═══
 *
 * Não cria disparo. A pessoa ainda vai escolher a conexão, escrever a mensagem e
 * ver o recorte. Subir uma planilha não é consentir em disparar para ela.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { montarRecortePorIds, MAX_DESTINATARIOS } from "@/lib/bulk-send/montagem";
import { CSV_MAX_BYTES } from "@/lib/contacts/csv";
import { importarLinhas, prepararLinhas, recusaDeFormato } from "@/lib/contacts/importar";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = req.headers.get("x-request-id") ?? randomUUID();
  // `manager`: subir a lista é o primeiro passo de mandar mensagem para muita
  // gente, e o disparo inteiro é manager+. Um `agent` importa contatos pela
  // tela de Contatos, que é outra coisa.
  const authz = await requireRole("manager", { requestId, resource: "bulk_sends" });
  if (!authz.ok) return authz.response;
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
    return fail(
      "validation_failed",
      `Arquivo maior que ${Math.floor(CSV_MAX_BYTES / 1024 / 1024)}MB.`,
      413,
      { requestId },
    );
  }

  const preparado = prepararLinhas(await file.text());
  if (preparado.erro !== null) {
    return fail("validation_failed", preparado.erro, 422, {
      requestId,
      ...(preparado.detalhe ? { details: preparado.detalhe } : {}),
    });
  }

  const supabase = await createClient();
  const { resumo, contatos } = await importarLinhas(supabase, {
    organizationId: orgId,
    userId: authz.user.id,
    indices: preparado.indices,
    dataRows: preparado.dataRows,
    requestId,
  });

  if (contatos.length === 0) {
    return fail(
      "bulk_send_sem_destinatario",
      "Nenhuma linha da planilha virou contato. Confira os erros por linha.",
      422,
      { requestId, details: { errors: resumo.errors } },
    );
  }
  if (contatos.length > MAX_DESTINATARIOS) {
    return fail(
      "validation_failed",
      `Máximo de ${MAX_DESTINATARIOS} destinatários por disparo — divida a planilha.`,
      422,
      { requestId },
    );
  }

  // O recorte, aqui e não só na criação: é o que a tela mostra ANTES de a pessoa
  // escolher a conexão. Ver "19 pediram para parar" no passo 1 pode mudar a
  // campanha inteira; ver no passo 4 já é tarde para escolher outra lista.
  const ids = contatos.map((c) => c.id);
  const recorte = await montarRecortePorIds(supabase, orgId, ids);

  // Mesma trilha da importação normal: quem olhar a auditoria vê que N contatos
  // entraram na base, e por qual caminho.
  await audit({
    action: "contacts.imported",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "contact",
    resourceId: null,
    requestId,
    metadata: {
      actor_type: "user",
      origem: "bulk_send",
      total_linhas: resumo.total_linhas,
      imported: resumo.imported,
      skipped_duplicates: resumo.skipped_duplicates,
      erros: resumo.errors.length,
    },
  });

  return ok(
    {
      contact_ids: ids,
      criados: resumo.imported,
      ja_existiam: contatos.length - resumo.imported,
      linhas_com_erro: resumo.errors,
      vao_receber: recorte.vaoReceber,
      fora_por_motivo: recorte.foraPorMotivo,
      repetidos: recorte.repetidos,
    },
    { requestId },
  );
}
