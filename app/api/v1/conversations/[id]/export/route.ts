/**
 * GET /api/v1/conversations/[id]/export?formato=pdf|xlsx — baixa a conversa.
 *
 * Lê com o cliente da SESSÃO, e não com a service role: quem decide se a pessoa
 * pode ver esta conversa é a mesma RLS da tela (`fn_can_view_conversation`) —
 * um atendente que não enxerga a conversa no inbox também não a baixa. Conversa
 * fora do acesso responde 404, igual à tela.
 *
 * Audita (`conversation.exported`): exportar é leitura, mas leitura em massa de
 * dado pessoal que sai do sistema.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { phoneForDisplay } from "@/lib/channels/phone-variants";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";
import {
  TETO_DA_EXPORTACAO,
  fusoSeguro,
  linhasDaConversa,
  nomeDoArquivo,
  type MensagemParaExportar,
} from "@/lib/conversas/exportar";
import { gerarPdfDaConversa, gerarXlsxDaConversa } from "@/lib/conversas/exportar-arquivos";
import { createClient } from "@/lib/supabase/server";
import { nomesDosAtendentes } from "@/lib/users/nome-do-atendente";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAGINA = 1000;
const formatoSchema = z.enum(["pdf", "xlsx"]);

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;

  const authz = await requireRole("agent", { requestId, resource: "conversation" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;

  const formato = formatoSchema.safeParse(req.nextUrl.searchParams.get("formato") ?? "pdf");
  if (!formato.success || !z.string().uuid().safeParse(id).success) {
    return fail("validation_failed", "Formato deve ser pdf ou xlsx.", 422, { requestId });
  }

  const supabase = await createClient();
  const { data: conversa } = await supabase
    .from("conversations")
    .select(
      "id, organization_id, contacts:contact_id (id, display_name, name, phone_number, is_anonymized), channel_sessions:channel_session_id (phone_number, display_name)",
    )
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .maybeSingle();
  if (!conversa) {
    return fail("not_found", "Conversa não encontrada ou fora do seu acesso.", 404, { requestId });
  }
  const contato = (
    conversa as unknown as {
      contacts: {
        display_name: string | null;
        name: string | null;
        phone_number: string | null;
      } | null;
    }
  ).contacts;
  const canal = (
    conversa as unknown as {
      channel_sessions: { phone_number: string | null; display_name: string | null } | null;
    }
  ).channel_sessions;

  // Das mais NOVAS para trás, até o teto; depois o arquivo põe em ordem de
  // leitura. Assim, conversa maior que o teto sai com o trecho recente — o que
  // se costuma querer provar — e o arquivo avisa que cortou.
  const mensagens: MensagemParaExportar[] = [];
  for (let de = 0; de < TETO_DA_EXPORTACAO; de += PAGINA) {
    const { data, error } = await supabase
      .from("messages")
      .select("id, direction, type, body, sent_via, sent_by_user_id, sent_at, status, revoked_at")
      .eq("conversation_id", id)
      .eq("organization_id", org.orgId)
      .order("sent_at", { ascending: false })
      .order("id", { ascending: false })
      .range(de, Math.min(de + PAGINA, TETO_DA_EXPORTACAO) - 1);
    if (error)
      return fail("internal_error", "Não consegui ler a conversa agora.", 500, { requestId });
    mensagens.push(...((data ?? []) as MensagemParaExportar[]));
    if ((data ?? []).length < PAGINA) break;
  }
  const cortado = mensagens.length >= TETO_DA_EXPORTACAO;

  const { data: orgLinha } = await supabase
    .from("organizations")
    .select("timezone")
    .eq("id", org.orgId)
    .maybeSingle();
  const fuso = fusoSeguro((orgLinha as { timezone?: string | null } | null)?.timezone);

  const nomesBrutos = await nomesDosAtendentes(mensagens.map((m) => m.sent_by_user_id));
  const nomes = new Map<string, string>();
  for (const [uid, nome] of nomesBrutos) if (nome) nomes.set(uid, nome);

  const linhas = linhasDaConversa(mensagens, fuso, nomes);
  const nomeDoContato = rotuloDoContato(contato);
  const agora = new Date();
  const cab = {
    contato: nomeDoContato,
    telefone: contato?.phone_number ? phoneForDisplay(contato.phone_number) : null,
    canal: canal?.phone_number ?? canal?.display_name ?? null,
    geradoEm: new Intl.DateTimeFormat("pt-BR", {
      timeZone: fuso,
      dateStyle: "short",
      timeStyle: "short",
    }).format(agora),
    total: linhas.length,
    cortado,
  };

  const arquivo =
    formato.data === "pdf"
      ? await gerarPdfDaConversa(cab, linhas)
      : await gerarXlsxDaConversa(cab, linhas);

  await audit({
    action: "conversation.exported",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "conversation",
    resourceId: id,
    requestId,
    metadata: { formato: formato.data, mensagens: linhas.length, cortado },
  });

  const nome = `${nomeDoArquivo(nomeDoContato, agora)}.${formato.data}`;
  return new Response(new Uint8Array(arquivo), {
    status: 200,
    headers: {
      "Content-Type":
        formato.data === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nome}"`,
      "Cache-Control": "private, no-store",
      "X-Request-Id": requestId,
    },
  });
}
