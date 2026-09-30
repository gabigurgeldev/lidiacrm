"use server";

import { headers } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/lib/auth/schemas";
import { audit, hashEmail } from "@/lib/audit";
import { authRateLimited, AUTH_LIMITS } from "@/lib/auth/rate-limit";
import { env } from "@/lib/env";
import { enviarRecuperacaoPeloApp } from "@/lib/auth/email-de-recuperacao";
import { isEmailConfigured } from "@/lib/email/resend";

export type RequestPasswordResetResult =
  | { ok: true }
  | {
      ok: false;
      error: "validation_error" | "rate_limited" | "request_failed";
      details?: Record<string, unknown>;
    };

/**
 * Pede o e-mail de redefinição de senha. Resposta neutra quanto à existência
 * do e-mail (o GoTrue responde 200 para e-mail desconhecido — não vaza nada);
 * erros aqui são só de infra (SMTP, rate limit).
 */
export async function requestPasswordReset(
  input: ForgotPasswordInput,
): Promise<RequestPasswordResetResult> {
  const parsed = forgotPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "validation_error",
      details: parsed.error.flatten().fieldErrors,
    };
  }

  const hdrs = await headers();
  const origin = hdrs.get("origin") ?? env.NEXT_PUBLIC_APP_URL;
  const requestId = hdrs.get("x-request-id");
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = hdrs.get("user-agent") ?? null;

  // Sem teto, este endpoint é uma metralhadora de e-mail contra terceiros e um
  // oráculo de enumeração de conta. Issue #64.
  if (await authRateLimited("reset", parsed.data.email, AUTH_LIMITS.reset)) {
    return { ok: false, error: "rate_limited" };
  }

  // Com e-mail configurado no app (SES/SMTP ou Resend), o CRM manda o e-mail com
  // a marca — ver `lib/auth/email-de-recuperacao.ts`. Só se isso falhar cai no
  // envio do próprio Supabase: um e-mail feio ainda é melhor que nenhum.
  if (isEmailConfigured()) {
    const desfecho = await enviarRecuperacaoPeloApp(
      parsed.data.email,
      `${origin}/auth/confirm?type=recovery`,
    );
    if (desfecho !== "falhou") {
      await audit({
        action: "auth.password_reset_requested",
        metadata: {
          email_hash: hashEmail(parsed.data.email),
          via: "app",
          conta_existe: desfecho === "enviado",
        },
        requestId,
        ip,
        userAgent,
      });
      return { ok: true };
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    // ?type=recovery sobrevive ao redirect do GoTrue (preserva query string
    // existente ao anexar `code=`/`token_hash=`) — sem SMTP customizado o
    // Supabase usa o template padrão dele, que só devolve `code` (PKCE), sem
    // `type`; /auth/confirm depende deste param pra saber que é recovery.
    redirectTo: `${origin}/auth/confirm?type=recovery`,
  });

  if (error) {
    if (error.status === 429) return { ok: false, error: "rate_limited" };
    await audit({
      action: "auth.password_reset_request_failed",
      metadata: {
        email_hash: hashEmail(parsed.data.email),
        reason: error.message,
      },
      requestId,
      ip,
      userAgent,
    });
    return { ok: false, error: "request_failed" };
  }

  await audit({
    action: "auth.password_reset_requested",
    metadata: { email_hash: hashEmail(parsed.data.email) },
    requestId,
    ip,
    userAgent,
  });

  return { ok: true };
}
