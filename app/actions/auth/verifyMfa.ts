"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { safeNext } from "@/lib/auth/safe-next";

import { createClient } from "@/lib/supabase/server";
import { audit } from "@/lib/audit";
import { cookieSecure } from "@/lib/supabase/cookie-secure";
import { classificarErroDeMfa, ehFalhaDeServico } from "@/lib/auth/erro-do-gotrue";
import { fatorTotpVerificado } from "@/lib/auth/fatores";

export type VerifyMfaResult =
  | { ok: false; error: "mfa_invalid" }
  | { ok: false; error: "service_unavailable" }
  | { ok: false; error: "mfa_locked"; retry_in_seconds: number };

const ATTEMPT_COOKIE = "mfa_attempts";
const ATTEMPT_TTL_SECONDS = 60;
const MAX_ATTEMPTS = 3;

/**
 * Verifies a TOTP code against the user's verified factor and (on success)
 * elevates the session to AAL2. On failure, increments an attempt counter
 * stored in a short-lived cookie. After 3 failures within 60s, the user is
 * locked out and must wait.
 *
 * Note: per-cookie counter is MVP. Hardening = Upstash Redis sliding window
 * keyed on user_id + IP.
 */
export async function verifyMfa(code: string, next?: string): Promise<VerifyMfaResult> {
  const supabase = await createClient();
  const hdrs = await headers();
  const requestId = hdrs.get("x-request-id");
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = hdrs.get("user-agent") ?? null;

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  // GoTrue fora do ar não é "sessão acabou": mandar para o `/login` aqui
  // jogava fora a senha que a pessoa acabou de acertar. Sem sessão de fato,
  // aí sim volta ao login.
  if (!user && ehFalhaDeServico(userErr)) {
    return { ok: false, error: "service_unavailable" };
  }
  if (!user) redirect("/login");

  // Sanity-check: must have a verified TOTP factor. Lido do `user` acima —
  // `listFactors()` refaria o mesmo `GET /user` no GoTrue.
  const totp = fatorTotpVerificado(user);
  if (!totp) redirect("/app/inbox");

  // Lockout check (cookie counter).
  const store = await cookies();
  const raw = store.get(ATTEMPT_COOKIE)?.value;
  let attempts = 0;
  if (raw) {
    const parsed = parseInt(raw, 10);
    if (!Number.isNaN(parsed)) attempts = parsed;
  }
  if (attempts >= MAX_ATTEMPTS) {
    return { ok: false, error: "mfa_locked", retry_in_seconds: ATTEMPT_TTL_SECONDS };
  }

  if (!/^\d{6}$/.test(code)) {
    return { ok: false, error: "mfa_invalid" };
  }

  // Issue challenge + verify.
  const { data: challenge, error: challengeErr } = await supabase.auth.mfa.challenge({
    factorId: totp.id,
  });
  if (challengeErr || !challenge) {
    // Desafio que não saiu por instabilidade não é código errado.
    if (classificarErroDeMfa(challengeErr) === "indisponivel") {
      return { ok: false, error: "service_unavailable" };
    }
    return { ok: false, error: "mfa_invalid" };
  }

  const { error: verifyErr } = await supabase.auth.mfa.verify({
    factorId: totp.id,
    challengeId: challenge.id,
    code,
  });

  // Só o código RECUSADO pelo GoTrue gasta tentativa. Um 504 no meio do verify
  // trancava por 60s quem digitou o código certo (`lib/auth/erro-do-gotrue.ts`).
  if (verifyErr && classificarErroDeMfa(verifyErr) === "indisponivel") {
    await audit({
      action: "auth.mfa_failed",
      actorUserId: user.id,
      metadata: {
        desfecho: "indisponivel",
        error_name: verifyErr.name,
        status: verifyErr.status ?? null,
      },
      requestId,
      ip,
      userAgent,
    });
    return { ok: false, error: "service_unavailable" };
  }

  if (verifyErr) {
    const newAttempts = attempts + 1;
    store.set(ATTEMPT_COOKIE, String(newAttempts), {
      httpOnly: true,
      sameSite: "strict",
      secure: cookieSecure(),
      maxAge: ATTEMPT_TTL_SECONDS,
      path: "/",
    });
    const locked = newAttempts >= MAX_ATTEMPTS;
    await audit({
      action: "auth.mfa_failed",
      actorUserId: user.id,
      metadata: { locked, attempts: newAttempts },
      requestId,
      ip,
      userAgent,
    });
    if (locked) {
      return { ok: false, error: "mfa_locked", retry_in_seconds: ATTEMPT_TTL_SECONDS };
    }
    return { ok: false, error: "mfa_invalid" };
  }

  // Reset attempt counter and audit success.
  store.delete(ATTEMPT_COOKIE);
  await audit({
    action: "auth.mfa_success",
    actorUserId: user.id,
    metadata: {},
    requestId,
    ip,
    userAgent,
  });

  redirect(safeNext(next, "/app/inbox"));
}
