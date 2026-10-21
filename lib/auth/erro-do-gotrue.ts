/**
 * O GoTrue RESPONDEU "não" ou simplesmente NÃO RESPONDEU?
 *
 * O login tratava qualquer `error` do `signInWithPassword` como senha errada:
 * mostrava "Email ou senha incorretos." e gastava uma tentativa do orçamento da
 * conta. Medido em produção em 2026-10-21: o GoTrue, sem pool de conexão com o
 * Postgres, devolveu 349 respostas 504 em 10 minutos. Cada uma virou, para
 * quem digitou a senha CERTA, um "senha incorreta" — e, repetida, um bloqueio
 * por excesso de tentativas que a pessoa nunca fez.
 *
 * A regra: só é culpa de quem digitou o que o GoTrue respondeu com um 4xx de
 * credencial. Rede caída, timeout, 5xx e qualquer coisa que não seja
 * `AuthApiError` são INSTABILIDADE — mensagem própria e nenhuma tentativa
 * contada.
 *
 * Compara por `name` e não por `instanceof` pelo mesmo motivo de
 * `ehSessaoAusente` (`lib/auth/server.ts`): há mais de uma cópia de
 * `@supabase/auth-js` na árvore, e `instanceof` só acerta na mesma cópia.
 */

export interface ErroDoAuth {
  name?: string;
  status?: number;
  code?: string;
}

/** Texto único para "o login não conseguiu falar com o servidor de contas". */
export const MENSAGEM_DE_INSTABILIDADE = "Instabilidade no login. Tente de novo em instantes.";

export type DesfechoDoLogin = "credencial" | "limite" | "indisponivel";

/**
 * - `credencial`: e-mail/senha recusados — conta no bloqueio.
 * - `limite`: o próprio GoTrue limitou (429) — não é senha errada.
 * - `indisponivel`: 5xx, timeout, rede, erro desconhecido — não conta.
 */
export function classificarErroDeLogin(error: ErroDoAuth | null | undefined): DesfechoDoLogin {
  if (!error || error.name !== "AuthApiError") return "indisponivel";
  if (error.code === "invalid_credentials" || error.status === 400) return "credencial";
  if (error.status === 429) return "limite";
  return "indisponivel";
}

/**
 * O GoTrue não respondeu (rede, timeout, 5xx)? Para o `getUser()` de quem já
 * deveria ter sessão: aqui o padrão é o OPOSTO das duas funções de cima —
 * sessão ausente e token recusado (401/403) são respostas, e levam ao login.
 */
export function ehFalhaDeServico(error: ErroDoAuth | null | undefined): boolean {
  if (!error) return false;
  if (error.name === "AuthRetryableFetchError" || error.name === "AuthUnknownError") return true;
  return error.name === "AuthApiError" && (error.status ?? 0) >= 500;
}

export type DesfechoDaMfa = "codigo" | "indisponivel";

/**
 * - `codigo`: o GoTrue respondeu e recusou o código/desafio (400/422) — conta.
 * - `indisponivel`: o resto — não conta, para não trancar quem digitou certo.
 */
export function classificarErroDeMfa(error: ErroDoAuth | null | undefined): DesfechoDaMfa {
  if (!error || error.name !== "AuthApiError") return "indisponivel";
  if (error.status === 400 || error.status === 422) return "codigo";
  return "indisponivel";
}
