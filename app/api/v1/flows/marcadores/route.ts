/**
 * GET /api/v1/flows/marcadores — os marcadores JÁ USADOS na organização.
 *
 * Sugestão para os blocos "Marcar"/"Desmarcar" e para a pergunta "tem o
 * marcador X" do "Decidir". Sem isto, marcar e perguntar são dois campos de
 * texto livre, e um `vip` contra um `VIP` produz um fluxo que nunca decide
 * certo — sem erro em lugar nenhum.
 *
 * ## Por que lendo as linhas, e não um vocabulário
 *
 * Marcador de lead/contato não tem lista canônica no produto:
 * `crm_pipelines.settings.canonical_tags` é outra coisa (a UMA tag que aparece
 * no card), e `organizations.settings.canonical_conversation_tags` é de
 * CONVERSA. Inventar uma tabela de vocabulário agora seria schema que ninguém
 * pediu para um campo de sugestão.
 *
 * RBAC manager+ para casar com o resto de `/api/v1/flows`: quem não pode ver
 * fluxo não tem por que enumerar os marcadores da operação.
 */
import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Teto de linhas lidas por tabela. Sugestão não justifica varredura inteira. */
const LINHAS = 2000;
/** Teto de marcadores devolvidos. Uma lista maior que isto não é escolhível. */
const MAXIMO = 100;

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "flows" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();
  const orgId = authz.org.orgId;

  const [leads, contatos] = await Promise.all([
    supabase
      .from("crm_leads")
      .select("tags")
      .eq("organization_id", orgId)
      .order("updated_at", { ascending: false })
      .limit(LINHAS),
    supabase
      .from("contacts")
      .select("tags")
      .eq("organization_id", orgId)
      .order("updated_at", { ascending: false })
      .limit(LINHAS),
  ]);

  const erro = leads.error ?? contatos.error;
  if (erro) return fail("internal_error", erro.message, 500, { requestId });

  // Por FREQUÊNCIA, não alfabética: quem monta um fluxo procura o marcador que a
  // operação usa todo dia, e ele raramente começa com "a".
  const quantos = new Map<string, number>();
  for (const linha of [...(leads.data ?? []), ...(contatos.data ?? [])]) {
    const tags = (linha as { tags?: unknown }).tags;
    if (!Array.isArray(tags)) continue;
    for (const tag of tags) {
      if (typeof tag !== "string" || tag.trim() === "") continue;
      quantos.set(tag, (quantos.get(tag) ?? 0) + 1);
    }
  }

  const marcadores = [...quantos.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, MAXIMO)
    .map(([tag]) => tag);

  return ok(marcadores, { requestId });
}
