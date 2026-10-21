/**
 * Quando o proxy pode deixar passar sem `getUser()` — e, tão importante quanto,
 * quando NÃO pode: página de verdade, `/admin`, e token perto de vencer.
 */
import { describe, expect, it } from "vitest";

import { dispensaDoGetUser, FOLGA_DE_VALIDADE_S, validadeDaSessao, type PedidoNoProxy } from "./proxy-dispensa";

const COOKIE = "sb-deskcomm-auth";
const AGORA = 1_800_000_000;

function sessao(expiresAt: number): string {
  const json = JSON.stringify({ access_token: "x", refresh_token: "y", expires_at: expiresAt });
  const b64url = Buffer.from(json, "utf8").toString("base64url");
  return `base64-${b64url}`;
}

function pedido(
  over: Partial<{ method: string; pathname: string; headers: Record<string, string>; cookies: Record<string, string> }>,
): PedidoNoProxy {
  const headers = over.headers ?? {};
  const cookies = over.cookies ?? { [COOKIE]: sessao(AGORA + 3600) };
  return {
    method: over.method ?? "GET",
    pathname: over.pathname ?? "/app/inbox",
    header: (n) => headers[n.toLowerCase()] ?? null,
    cookie: (n) => cookies[n],
  };
}

describe("dispensaDoGetUser — o que pula o GoTrue", () => {
  it("prefetch do roteador em /app/* passa sem getUser", () => {
    expect(dispensaDoGetUser(pedido({ headers: { "next-router-prefetch": "1" } }), COOKIE, AGORA)).toBe(
      "prefetch",
    );
    expect(dispensaDoGetUser(pedido({ headers: { purpose: "prefetch" } }), COOKIE, AGORA)).toBe("prefetch");
    expect(dispensaDoGetUser(pedido({ headers: { "sec-purpose": "prefetch;prerender" } }), COOKIE, AGORA)).toBe(
      "prefetch",
    );
  });

  it("POST de Server Action passa sem getUser — em qualquer caminho", () => {
    expect(
      dispensaDoGetUser(pedido({ method: "POST", pathname: "/app/settings", headers: { "next-action": "abc" } }), COOKIE, AGORA),
    ).toBe("server_action");
  });

  it("avatar e mídia passam — as rotas abrem com loadAuthUser", () => {
    expect(dispensaDoGetUser(pedido({ pathname: "/api/v1/contacts/c-1/avatar" }), COOKIE, AGORA)).toBe(
      "rota_autenticada",
    );
    expect(dispensaDoGetUser(pedido({ pathname: "/api/v1/messages/m-1/media" }), COOKIE, AGORA)).toBe(
      "rota_autenticada",
    );
  });
});

describe("dispensaDoGetUser — o que continua passando pelo getUser", () => {
  it("navegação normal para uma página chama getUser", () => {
    expect(dispensaDoGetUser(pedido({}), COOKIE, AGORA)).toBeNull();
  });

  it("prefetch fora de /app (ex.: /admin, onde o proxy é o gate de platform admin) não pula", () => {
    const h = { headers: { "next-router-prefetch": "1" } };
    expect(dispensaDoGetUser(pedido({ ...h, pathname: "/admin/tenants" }), COOKIE, AGORA)).toBeNull();
    expect(dispensaDoGetUser(pedido({ ...h, pathname: "/onboarding" }), COOKIE, AGORA)).toBeNull();
    // `/application` não é `/app/`.
    expect(dispensaDoGetUser(pedido({ ...h, pathname: "/application" }), COOKIE, AGORA)).toBeNull();
  });

  it("outras rotas de API e sub-caminhos de avatar não pulam", () => {
    expect(dispensaDoGetUser(pedido({ pathname: "/api/v1/conversations" }), COOKIE, AGORA)).toBeNull();
    expect(dispensaDoGetUser(pedido({ pathname: "/api/v1/contacts/c-1/avatar/x" }), COOKIE, AGORA)).toBeNull();
  });

  it("next-action num GET não é Server Action", () => {
    expect(dispensaDoGetUser(pedido({ headers: { "next-action": "abc" } }), COOKIE, AGORA)).toBeNull();
  });

  it("sem cookie de sessão: caminho completo (que não custa rede — o SDK corta antes)", () => {
    expect(dispensaDoGetUser(pedido({ pathname: "/api/v1/messages/m-1/media", cookies: {} }), COOKIE, AGORA)).toBeNull();
  });

  it("token perto de vencer: caminho completo, para o proxy renovar e gravar o cookie", () => {
    const quase = { [COOKIE]: sessao(AGORA + FOLGA_DE_VALIDADE_S - 1) };
    const vencido = { [COOKIE]: sessao(AGORA - 10) };
    const p = { headers: { "next-router-prefetch": "1" } };
    expect(dispensaDoGetUser(pedido({ ...p, cookies: quase }), COOKIE, AGORA)).toBeNull();
    expect(dispensaDoGetUser(pedido({ ...p, cookies: vencido }), COOKIE, AGORA)).toBeNull();
  });

  it("cookie ilegível: caminho completo", () => {
    const lixo = { [COOKIE]: "base64-%%%nao-e-base64" };
    expect(dispensaDoGetUser(pedido({ pathname: "/api/v1/messages/m-1/media", cookies: lixo }), COOKIE, AGORA)).toBeNull();
  });
});

describe("validadeDaSessao", () => {
  it("lê o cookie em pedaços .0/.1 como o @supabase/ssr grava", () => {
    const inteiro = sessao(AGORA + 500);
    const meio = Math.floor(inteiro.length / 2);
    const cookies: Record<string, string> = {
      [`${COOKIE}.0`]: inteiro.slice(0, meio),
      [`${COOKIE}.1`]: inteiro.slice(meio),
    };
    expect(validadeDaSessao((n) => cookies[n], COOKIE)).toBe(AGORA + 500);
  });

  it("aceita JSON cru (formato antigo, sem prefixo base64-)", () => {
    const cookies = { [COOKIE]: JSON.stringify({ expires_at: AGORA + 42 }) };
    expect(validadeDaSessao((n) => cookies[n as keyof typeof cookies], COOKIE)).toBe(AGORA + 42);
  });
});
