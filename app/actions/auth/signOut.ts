"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient, NOME_DO_COOKIE_DE_SESSAO } from "@/lib/supabase/server";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { usuarioDaRequisicao } from "@/lib/auth/server";

/**
 * Sair NUNCA termina numa tela de erro.
 *
 * Medido em produção em 2026-10-21: com o GoTrue devolvendo 504, clicar em
 * "Sair" caía em `app/app/error.tsx`. Três coisas mudaram:
 *
 * - `scope: "local"` — o padrão do SDK é `global`, que encerra a sessão em
 *   TODOS os aparelhos: sair no celular deslogava o notebook.
 * - Se o GoTrue não responder, o SDK devolve `error` e NÃO apaga o cookie. Aqui
 *   o cookie é apagado assim mesmo: quem clicou em "Sair" sai deste navegador.
 *   A sessão no servidor expira sozinha.
 * - O audit não segura o redirect (`void`): falha de audit alerta, não bloqueia.
 */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  const hdrs = await headers();
  const store = await cookies();

  let userId: string | null = null;
  try {
    const {
      data: { user },
    } = await usuarioDaRequisicao();
    userId = user?.id ?? null;
  } catch {
    // Sem saber quem é, ainda dá para sair — só não há o que auditar.
  }

  let falhou = false;
  try {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    falhou = !!error;
    if (error) {
      logger.warn("[auth] signOut no GoTrue falhou — apagando o cookie mesmo assim", {
        name: error.name,
        status: error.status ?? null,
        message: error.message,
      });
    }
  } catch (err) {
    falhou = true;
    logger.warn("[auth] signOut lançou — apagando o cookie mesmo assim", {
      message: err instanceof Error ? err.message : String(err),
    });
  }
  if (falhou) {
    for (const { name } of store.getAll()) {
      if (name.startsWith(NOME_DO_COOKIE_DE_SESSAO)) store.delete(name);
    }
  }

  // Clear active_org cookie too.
  store.delete("active_org");

  if (userId) {
    void audit({
      action: "auth.logout",
      actorUserId: userId,
      metadata: falhou ? { gotrue_indisponivel: true } : {},
      requestId: hdrs.get("x-request-id"),
      ip: hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: hdrs.get("user-agent") ?? null,
    });
  }

  redirect("/login");
}
