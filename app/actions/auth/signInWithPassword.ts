"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { safeNext } from "@/lib/auth/safe-next";

import { createClient } from "@/lib/supabase/server";
import { loginSchema, type LoginInput } from "@/lib/auth/schemas";
import { audit, hashEmail } from "@/lib/audit";
import {
  authRateLimited,
  contaBloqueadaPorFalhas,
  registrarFalhaDeLogin,
  AUTH_LIMITS,
} from "@/lib/auth/rate-limit";
import { classificarErroDeLogin } from "@/lib/auth/erro-do-gotrue";
import { fatorTotpVerificado } from "@/lib/auth/fatores";

export type SignInResult = {
  ok: false;
  error:
    | "invalid_credentials"
    | "rate_limited"
    | "validation_error"
    | "mfa_required"
    | "service_unavailable";
  details?: Record<string, unknown>;
  challengeId?: string;
};

/**
 * Sign in with password.
 *
 * On success: redirects server-side to `next` (or /app/inbox / /onboarding/mfa).
 * The redirect ensures Set-Cookie headers from supabase.auth propagate before
 * middleware re-evaluates the session — fixes Next 15 Server Action cookie
 * propagation race.
 *
 * On failure: returns an error discriminator. Caller renders inline message.
 */
export async function signInWithPassword(
  input: LoginInput,
  next?: string,
): Promise<SignInResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "validation_error",
      details: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const hdrs = await headers();
  const requestId = hdrs.get("x-request-id");
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = hdrs.get("user-agent") ?? null;

  // Antes de falar com o GoTrue: sem isto, tentar senha era de graça e
  // ilimitado (issue #64). Conta por IP e por conta — o ataque distribuído
  // contra um e-mail só não aparece na contagem por IP.
  if (
    (await authRateLimited("login", null, AUTH_LIMITS.login)) ||
    (await contaBloqueadaPorFalhas(parsed.data.email, AUTH_LIMITS.login))
  ) {
    await audit({
      action: "auth.login_rate_limited",
      metadata: { email_hash: hashEmail(parsed.data.email) },
      requestId,
      ip,
      userAgent,
    });
    return { ok: false, error: "rate_limited" };
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error || !data.user) {
    // Só senha errada gasta o orçamento da conta — e só senha errada é dita
    // como senha errada. Um 504 do GoTrue virava "Email ou senha incorretos."
    // para quem digitou a senha certa, e ainda contava no bloqueio. Regra e
    // medição em `lib/auth/erro-do-gotrue.ts`.
    const desfecho = classificarErroDeLogin(error);
    if (desfecho === "credencial") {
      await registrarFalhaDeLogin(parsed.data.email, AUTH_LIMITS.login);
    }
    await audit({
      action: "auth.login_failed",
      metadata: {
        email_hash: hashEmail(parsed.data.email),
        reason: error?.message ?? "unknown",
        desfecho,
        error_name: error?.name ?? null,
        status: error?.status ?? null,
      },
      requestId,
      ip,
      userAgent,
    });
    if (desfecho === "credencial") return { ok: false, error: "invalid_credentials" };
    if (desfecho === "limite") return { ok: false, error: "rate_limited" };
    return { ok: false, error: "service_unavailable" };
  }

  // MFA gating — if the user has any verified TOTP factor enrolled, they must
  // complete the challenge in /login/mfa before reaching the app.
  //
  // Quando os fatores já vieram no `data.user` do login, lê dali: `listFactors()`
  // refaz o `GET /user` no GoTrue só para devolver a mesma lista. O GoTrue
  // OMITE `factors` quando a lista está vazia, e ausente aqui não pode virar
  // "sem MFA" — pularia o desafio de quem tem fator. Então ausente pergunta.
  const verifiedTotp = Array.isArray(data.user.factors)
    ? fatorTotpVerificado(data.user)
    : ((await supabase.auth.mfa.listFactors()).data?.totp?.find((f) => f.status === "verified") ??
      null);
  if (verifiedTotp) {
    return { ok: false, error: "mfa_required", challengeId: verifiedTotp.id };
  }

  await audit({
    action: "auth.login_success",
    actorUserId: data.user.id,
    metadata: {},
    requestId,
    ip,
    userAgent,
  });

  // Server-side redirect ensures fresh session cookie is sent to browser.
  redirect(safeNext(next, "/app/inbox"));
}
