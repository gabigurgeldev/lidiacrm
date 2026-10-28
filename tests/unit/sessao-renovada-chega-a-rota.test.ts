import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * A SESSÃO RENOVADA CHEGA À ROTA — e renovação descartada não desloga ninguém.
 *
 * ─── O defeito, medido em produção em 2026-10-27 ────────────────────────────
 *
 * Usuários logados eram "deslogados" ao longo do dia. No log do app, 9 linhas
 * `[auth] getUser falhou — tratando como não autenticado` em 3 h, todas com
 * `AuthRefreshDiscardedError` (409); no GoTrue, três `POST /token` no mesmo
 * segundo para a mesma pessoa e nenhuma recusa.
 *
 * A cadeia: o token vence → o `proxy.ts` renova, mas o cookie novo só ia para o
 * browser (o `NextResponse.next` copia os headers da requisição ao ser criado)
 * → o Route Handler lê o cookie VELHO, e o Next não funde o `Set-Cookie` do
 * proxy em Route Handler → a rota cria dois clientes Supabase, os dois renovam,
 * o `auth-js` descarta a renovação de um deles → `getUser()` sem usuário → 401.
 *
 * ─── Por que dois testes ────────────────────────────────────────────────────
 *
 * O primeiro prende a CAUSA (a requisição repassada leva o cookie novo). O
 * segundo prende a REDE: se outra corrida produzir o descarte, ele não vira
 * "sem sessão".
 */

const sessao: { setAll?: (c: { name: string; value: string; options: object }[]) => void } = {};
const getUserDoCliente = vi.fn();

vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "http://supabase.test",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    NEXT_PUBLIC_APP_URL: "https://crm.test",
    IMPERSONATE_COOKIE_SECRET: "x".repeat(32),
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: { cookies: { setAll: typeof sessao.setAll } },
  ) => {
    sessao.setAll = opts.cookies.setAll;
    return { auth: { getUser: getUserDoCliente } };
  },
}));

const { proxy } = await import("@/proxy");
const { createClient } = await import("@/lib/supabase/server");

beforeEach(() => {
  getUserDoCliente.mockReset();
});

describe("proxy — o cookie renovado viaja na requisição repassada", () => {
  it("a rota recebe o token NOVO, não o vencido que o browser mandou", async () => {
    getUserDoCliente.mockImplementation(async () => {
      // O que o `@supabase/ssr` faz ao renovar: chama `setAll` com o cookie novo.
      sessao.setAll?.([
        { name: "sb-deskcomm-auth", value: "token-novo", options: { path: "/" } },
      ]);
      return { data: { user: { id: "u1" } }, error: null };
    });

    const req = new NextRequest("https://crm.test/api/v1/pipelines/p1/board", {
      headers: { cookie: "sb-deskcomm-auth=token-vencido" },
    });
    const res = await proxy(req);

    // `x-middleware-request-cookie` é o cookie com que o Next chama a rota.
    const repassado = res.headers.get("x-middleware-request-cookie") ?? "";
    expect(repassado).toContain("sb-deskcomm-auth=token-novo");
    expect(repassado).not.toContain("token-vencido");
    // E o browser também recebe — senão a próxima requisição renova de novo.
    expect(res.cookies.get("sb-deskcomm-auth")?.value).toBe("token-novo");
    // Os headers que o proxy injeta sobrevivem à resposta refeita.
    expect(res.headers.get("x-request-id")).toBeTruthy();
    expect(res.headers.get("x-pathname")).toBe("/api/v1/pipelines/p1/board");
  });
});

describe("createClient — renovação descartada não é sessão ausente", () => {
  it("lê de novo e devolve o usuário que o cliente vencedor deixou no cookie", async () => {
    getUserDoCliente
      .mockResolvedValueOnce({
        data: { user: null },
        error: { name: "AuthRefreshDiscardedError", status: 409, message: "discarded" },
      })
      .mockResolvedValueOnce({ data: { user: { id: "u1" } }, error: null });

    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();

    expect(error).toBeNull();
    expect(data.user?.id).toBe("u1");
    expect(getUserDoCliente).toHaveBeenCalledTimes(2);
  });

  it("qualquer outro erro passa direto, sem segunda ida ao GoTrue", async () => {
    // Sessão ausente e token recusado são RESPOSTAS — repetir só dobraria a
    // carga no GoTrue, que já saturou uma vez (2026-10-21).
    getUserDoCliente.mockResolvedValue({
      data: { user: null },
      error: { name: "AuthSessionMissingError", status: 400, message: "missing" },
    });

    const supabase = await createClient();
    const { error } = await supabase.auth.getUser();

    expect(error?.name).toBe("AuthSessionMissingError");
    expect(getUserDoCliente).toHaveBeenCalledTimes(1);
  });
});
