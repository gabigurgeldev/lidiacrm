"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { assinaturaSchema, type AssinaturaDoAtendente } from "@/lib/assinatura-do-atendente";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";

/**
 * Liga/desliga a assinatura do atendente e grava o nome — pelo botão do
 * composer do inbox.
 *
 * Grava em `user_metadata.assinatura`, a PREFERÊNCIA da pessoa (como o idioma
 * do topo em `trocarIdioma`): ligar a própria assinatura não muda o que os
 * colegas enviam. Quem lê é `loadAuthUser`, e a rota de envio assina com o que
 * veio dali — nunca com um nome mandado pelo cliente.
 */
export async function salvarAssinatura(
  entrada: AssinaturaDoAtendente,
): Promise<{ ok: true; assinatura: AssinaturaDoAtendente } | { ok: false; error: string }> {
  const parsed = assinaturaSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Assinatura inválida." };
  }
  const assinatura = parsed.data;

  const authUser = await loadAuthUser();
  if (!authUser) return { ok: false, error: "unauthenticated" };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ data: { assinatura } });
  if (error) return { ok: false, error: error.message };

  const hdrs = await headers();
  const activeOrg = await resolveActiveOrg(authUser);
  await audit({
    action: "profile.signature_changed",
    actorUserId: authUser.id,
    organizationId: activeOrg?.orgId ?? null,
    resourceType: "user",
    resourceId: authUser.id,
    requestId: hdrs.get("x-request-id"),
    ip: hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: hdrs.get("user-agent") ?? null,
    metadata: { ativa: assinatura.ativa, nome: assinatura.nome },
  });

  // O AuthProvider recebe o usuário do layout; sem revalidar, o composer
  // seguiria mostrando a preferência antiga até a próxima navegação.
  revalidatePath("/app", "layout");
  return { ok: true, assinatura };
}
