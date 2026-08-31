/**
 * GET /api/v1/bulk-sends/[id]/recipients — a lista de quem recebeu e quem não.
 *
 * É a tela que responde "deu certo?" linha a linha. Cada não-envio vem com a
 * frase em pt-BR e o PRÓXIMO PASSO — invariante 4 do sistema vivo: nenhuma
 * demanda sem próximo passo. Uma lista de 88 pessoas sem dizer o que fazer com
 * cada uma é um número que assusta e não resolve.
 *
 * Traz o contato junto (nome e telefone) porque a tela precisa dizer PARA QUEM
 * não foi. Só essas duas colunas: é PII, e a tela não precisa do dossiê.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { fraseDoPulo } from "@/lib/bulk-send/frases";
import { listarDestinatariosSchema } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = req.headers.get("x-request-id") ?? randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "bulk_sends" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;
  const { id } = await ctx.params;

  const url = new URL(req.url);
  const lido = listarDestinatariosSchema.safeParse({
    status: url.searchParams.get("status") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
  });
  if (!lido.success) {
    return fail("validation_failed", "Filtro inválido.", 422, { requestId });
  }
  const { status, limit, cursor } = lido.data;

  const supabase = await createClient();
  let query = supabase
    .from("bulk_send_recipients")
    .select(
      "id, status, skip_reason, error, sent_at, message_id, contact_id, contacts:contact_id(display_name, name, phone_number)",
    )
    .eq("bulk_send_id", id)
    .eq("organization_id", orgId)
    // Ordem por `id` porque é a MESMA ordem em que o motor consome a fila —
    // a página que a tela mostra bate com a ordem real dos envios.
    .order("id", { ascending: true })
    .limit(limit + 1);

  if (status) query = query.eq("status", status);
  if (cursor) query = query.gt("id", cursor);

  const { data, error } = await query;
  if (error) return fail("internal_error", error.message, 500, { requestId });

  const linhas = (data ?? []) as unknown as Array<{
    id: string;
    status: string;
    skip_reason: string | null;
    error: string | null;
    sent_at: string | null;
    message_id: string | null;
    contact_id: string;
    contacts: { display_name: string | null; name: string | null; phone_number: string | null } | null;
  }>;

  const temMais = linhas.length > limit;
  const pagina = temMais ? linhas.slice(0, limit) : linhas;

  return ok(
    pagina.map((l) => ({
      id: l.id,
      contact_id: l.contact_id,
      nome: l.contacts?.display_name ?? l.contacts?.name ?? null,
      telefone: l.contacts?.phone_number ?? null,
      status: l.status,
      sent_at: l.sent_at,
      message_id: l.message_id,
      // `error` já vem traduzido pelo motor (`fraseDaFalhaDeCanal`); o pulo é
      // traduzido aqui. Código cru não chega à tela por nenhum dos dois caminhos.
      motivo: l.skip_reason ? fraseDoPulo(l.skip_reason) : null,
      erro: l.error,
    })),
    {
      requestId,
      meta: { cursor: temMais ? (pagina.at(-1)?.id ?? null) : null, has_more: temMais },
    },
  );
}
