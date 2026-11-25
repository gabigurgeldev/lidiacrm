"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";

const entradaSchema = z.object({ ligado: z.boolean() });

/**
 * Liga/desliga o som de aviso (mensagem e lead novo) — Configurações ›
 * Notificações.
 *
 * Grava em `user_metadata.notify_sound`, preferência DA PESSOA, como o idioma
 * (`trocarIdioma`) e a assinatura (`salvarAssinatura`): segue a atendente em
 * qualquer computador, e desligar o próprio som não muda o dos colegas. Quem lê
 * é `loadAuthUser` (`AuthUser.som_de_aviso`, ausente = ligado).
 */
export async function salvarSomDeAviso(
  entrada: { ligado: boolean },
): Promise<{ ok: true; ligado: boolean } | { ok: false; error: string }> {
  const parsed = entradaSchema.safeParse(entrada);
  if (!parsed.success) return { ok: false, error: "invalid_request" };
  const { ligado } = parsed.data;

  const authUser = await loadAuthUser();
  if (!authUser) return { ok: false, error: "unauthenticated" };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ data: { notify_sound: ligado } });
  if (error) return { ok: false, error: error.message };

  const hdrs = await headers();
  const activeOrg = await resolveActiveOrg(authUser);
  await audit({
    action: "notification_prefs.changed",
    actorUserId: authUser.id,
    organizationId: activeOrg?.orgId ?? null,
    resourceType: "user",
    resourceId: authUser.id,
    requestId: hdrs.get("x-request-id"),
    ip: hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: hdrs.get("user-agent") ?? null,
    metadata: { som_de_aviso: ligado },
  });

  // A casca recebe o usuário do layout: sem revalidar, a preferência antiga
  // seguiria valendo nas outras telas até a próxima navegação completa.
  revalidatePath("/app", "layout");
  return { ok: true, ligado };
}
