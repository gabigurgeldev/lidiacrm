/**
 * A FIAÇÃO da dispensa no `proxy`: a regra pura tem teste próprio
 * (`lib/auth/proxy-dispensa.test.ts`); este prova que o proxy de fato não chama
 * `getUser()` nos casos dispensados — e que continua chamando na página normal.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getUser = vi.fn(async () => ({ data: { user: { id: "u-1" } }, error: null }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({ auth: { getUser }, rpc: vi.fn() })),
}));
vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "http://sb.local",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    NEXT_PUBLIC_APP_URL: "http://crm.local",
  },
}));

const { proxy } = await import("./proxy");

function cookieDeSessao(expiraEmS: number): string {
  const json = JSON.stringify({ access_token: "a", refresh_token: "r", expires_at: expiraEmS });
  return `sb-deskcomm-auth=base64-${Buffer.from(json, "utf8").toString("base64url")}`;
}

function req(caminho: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  const validade = Math.floor(Date.now() / 1000) + 3600;
  return new NextRequest(`http://crm.local${caminho}`, {
    method: init.method ?? "GET",
    headers: { cookie: cookieDeSessao(validade), ...(init.headers ?? {}) },
  });
}

beforeEach(() => getUser.mockClear());

describe("proxy — getUser só onde ele é a porta", () => {
  it("página normal chama getUser", async () => {
    await proxy(req("/app/inbox"));
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it("prefetch de /app/* não chama", async () => {
    const r = await proxy(req("/app/inbox", { headers: { "next-router-prefetch": "1" } }));
    expect(getUser).not.toHaveBeenCalled();
    expect(r.status).toBe(200);
  });

  it("POST de Server Action não chama", async () => {
    await proxy(req("/app/settings", { method: "POST", headers: { "next-action": "id-da-acao" } }));
    expect(getUser).not.toHaveBeenCalled();
  });

  it("avatar e mídia não chamam", async () => {
    await proxy(req("/api/v1/contacts/c-1/avatar"));
    await proxy(req("/api/v1/messages/m-1/media"));
    expect(getUser).not.toHaveBeenCalled();
  });

  it("outra rota de API chama", async () => {
    await proxy(req("/api/v1/conversations"));
    expect(getUser).toHaveBeenCalledTimes(1);
  });
});
