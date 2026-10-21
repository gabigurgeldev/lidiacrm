/**
 * Sair encerra SÓ esta sessão, e sai mesmo com o GoTrue fora do ar.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const signOutSdk = vi.fn();
const apagar = vi.fn();
const redirect = vi.fn();
const audit = vi.fn(async (_entrada: unknown) => undefined);

vi.mock("next/headers", () => ({
  headers: async () => ({ get: () => null }),
  cookies: async () => ({
    getAll: () => [
      { name: "sessao-teste.0", value: "a" },
      { name: "sessao-teste.1", value: "b" },
      { name: "active_org", value: "o" },
      { name: "sidebar_collapsed", value: "1" },
    ],
    delete: apagar,
  }),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }));
vi.mock("@/lib/audit", () => ({ audit: (e: unknown) => audit(e) }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/supabase/server", () => ({
  NOME_DO_COOKIE_DE_SESSAO: "sessao-teste",
  createClient: async () => ({ auth: { signOut: signOutSdk } }),
}));
vi.mock("@/lib/auth/server", () => ({
  usuarioDaRequisicao: async () => ({ data: { user: { id: "u-1" } }, error: null }),
}));

const { signOut } = await import("./signOut");

beforeEach(() => {
  signOutSdk.mockReset();
  apagar.mockReset();
  redirect.mockReset();
  audit.mockClear();
});

describe("signOut", () => {
  it("encerra só esta sessão (scope local), não as dos outros aparelhos", async () => {
    signOutSdk.mockResolvedValue({ error: null });
    await signOut();
    expect(signOutSdk).toHaveBeenCalledWith({ scope: "local" });
    expect(redirect).toHaveBeenCalledWith("/login");
    // Caminho feliz: o SDK já apagou o cookie; aqui só sai o active_org.
    expect(apagar.mock.calls.map((c) => c[0])).toEqual(["active_org"]);
    expect(audit).toHaveBeenCalledTimes(1);
  });

  it("GoTrue em 504: apaga o cookie de sessão assim mesmo e vai para o /login", async () => {
    signOutSdk.mockResolvedValue({
      error: { name: "AuthRetryableFetchError", status: 504, message: "Gateway Timeout" },
    });
    await signOut();
    const apagados = apagar.mock.calls.map((c) => c[0]);
    expect(apagados).toEqual(expect.arrayContaining(["sessao-teste.0", "sessao-teste.1", "active_org"]));
    expect(apagados).not.toContain("sidebar_collapsed");
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("SDK que LANÇA também não impede a saída", async () => {
    signOutSdk.mockRejectedValue(new Error("fetch failed"));
    await signOut();
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("audit que trava não segura o redirect", async () => {
    signOutSdk.mockResolvedValue({ error: null });
    audit.mockImplementationOnce(() => new Promise(() => {}));
    await signOut();
    expect(redirect).toHaveBeenCalledWith("/login");
  });
});
