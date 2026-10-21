/**
 * O erro é o `redirect()` de uma Server Action, e não uma falha?
 *
 * `redirect()` lança um sentinela com `digest` começando por `NEXT_REDIRECT`.
 * Num `try/catch` em volta da ação, engolir esse sentinela cancela a navegação
 * — o login "funciona" e a pessoa fica parada na tela. Quem embrulha uma ação
 * que redireciona RELANÇA quando isto devolve `true`.
 *
 * Mesmo critério do `isRedirectError` local de
 * `app/onboarding/connect-whatsapp/_client.tsx`.
 */
export function ehRedirectDoNext(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === "object" &&
      "digest" in err &&
      typeof (err as { digest?: unknown }).digest === "string" &&
      (err as { digest: string }).digest.startsWith("NEXT_REDIRECT"),
  );
}
