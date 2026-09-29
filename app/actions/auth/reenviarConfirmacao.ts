"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { audit, hashEmail } from "@/lib/audit";
import { authRateLimited, AUTH_LIMITS } from "@/lib/auth/rate-limit";
import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type ReenvioResult = { ok: true } | { ok: false; error: "rate_limited" | "invalid" };

/**
 * "Não chegou? Reenviar" da tela de confirmação do cadastro.
 *
 * Anti-enumeração como o próprio cadastro: a resposta é a MESMA para e-mail
 * que existe, que não existe ou que já foi confirmado — o GoTrue não
 * diferencia e nós não repassamos o erro. O limite é duplo: o nosso (por IP e
 * por e-mail, `AUTH_LIMITS.reset`) e o do GoTrue (um envio por minuto por
 * endereço), que a tela já respeita com a contagem regressiva.
 */
export async function reenviarConfirmacao(email: string): Promise<ReenvioResult> {
  const parsed = z.string().email().safeParse(email);
  if (!parsed.success) return { ok: false, error: "invalid" };

  if (await authRateLimited("signup_resend", parsed.data, AUTH_LIMITS.reset)) {
    return { ok: false, error: "rate_limited" };
  }

  const hdrs = await headers();
  const origin = hdrs.get("origin") ?? env.NEXT_PUBLIC_APP_URL;
  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: parsed.data,
    options: { emailRedirectTo: `${origin}/auth/confirm?type=signup` },
  });
  if (error?.status === 429) return { ok: false, error: "rate_limited" };

  void audit({
    action: "auth.signup_requested",
    metadata: { email_hash: hashEmail(parsed.data), reenvio: true, falhou: Boolean(error) },
    requestId: hdrs.get("x-request-id"),
  });
  return { ok: true };
}
