/**
 * Supabase client para Server Components, Route Handlers e Server Actions.
 *
 * Lê/escreve cookies via next/headers. Sempre use `getUser()` (valida JWT no
 * backend), NUNCA `getSession()` (confia no cookie local sem revalidar).
 */

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookieSecure } from "@/lib/supabase/cookie-secure";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { ehRefreshDescartado } from "@/lib/auth/erro-do-gotrue";

/** Nome do cookie de sessão — o mesmo do browser e do `proxy.ts`. */
export const NOME_DO_COOKIE_DE_SESSAO = "sb-deskcomm-auth";

export async function createClient() {
  const cookieStore = await cookies();

  const client = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // setAll pode ser chamado de Server Component; nesse caso, ignoramos.
          // Refresh de sessão acontece no middleware do Next.
        }
      },
    },
    // D-01.01: cookie name canônico alinhado ao middleware.
    cookieOptions: {
      name: NOME_DO_COOKIE_DE_SESSAO,
      sameSite: "strict",
      httpOnly: true,
      secure: cookieSecure(),
      path: "/",
    },
  });

  // Renovação descartada por corrida NÃO é "sem sessão" (ver
  // `ehRefreshDescartado`). Duas leituras do cookie bastam: depois do descarte,
  // o cookie já tem os tokens que o cliente vencedor gravou. Aqui, e não em cada
  // chamador, porque são dezenas de rotas chamando `auth.getUser()` direto — e o
  // `proxy.ts` já elimina a causa comum; isto cobre o que sobrar.
  const getUser = client.auth.getUser.bind(client.auth);
  client.auth.getUser = async (jwt?: string) => {
    const primeira = await getUser(jwt);
    return ehRefreshDescartado(primeira.error) ? getUser(jwt) : primeira;
  };

  return client;
}
