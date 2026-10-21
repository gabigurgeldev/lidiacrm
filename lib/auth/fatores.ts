/**
 * Fatores de MFA lidos do `user` que o GoTrue JÁ devolveu.
 *
 * `auth.mfa.listFactors()` não tem endpoint próprio: por dentro ele chama
 * `getUser()` — um `GET /user` a mais no GoTrue — e filtra `user.factors`.
 * Quem já tem o `user` em mãos (do `getUser()`, do `signInWithPassword`) lê
 * daqui e poupa a ida. Critério idêntico ao `listFactors().totp`: só TOTP, só
 * `verified`.
 */

interface FatorBruto {
  id?: string;
  factor_type?: string;
  status?: string;
}

interface ComFatores {
  factors?: ReadonlyArray<FatorBruto> | null;
}

/** O primeiro fator TOTP verificado, ou `null`. */
export function fatorTotpVerificado<F extends FatorBruto>(
  user: { factors?: ReadonlyArray<F> | null } | null | undefined,
): F | null {
  return user?.factors?.find((f) => f.factor_type === "totp" && f.status === "verified") ?? null;
}

/** Algum fator TOTP verificado? */
export function temFatorTotpVerificado(user: ComFatores | null | undefined): boolean {
  return fatorTotpVerificado(user) !== null;
}
