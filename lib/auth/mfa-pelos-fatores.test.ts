/**
 * `isMfaEnrolled` lê `user.factors` — sem `auth.mfa.listFactors()`, que por
 * dentro refaz o `GET /user` no GoTrue. E quem já tem o AuthUser em mãos não
 * vai ao GoTrue de jeito nenhum.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthUser } from "./types";

const getUser = vi.fn();
const listFactors = vi.fn();

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [] }) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser, mfa: { listFactors } } })),
}));

const { isMfaEnrolled, mfaEmDivida } = await import("./server");
const { fatorTotpVerificado, temFatorTotpVerificado } = await import("./fatores");

function comFatores(factors: unknown[] | undefined) {
  getUser.mockResolvedValue({ data: { user: { id: "u-1", factors } }, error: null });
}

beforeEach(() => {
  getUser.mockReset();
  listFactors.mockReset();
});

describe("isMfaEnrolled — pelos fatores do user", () => {
  it("TOTP verificado = cadastrado, sem listFactors", async () => {
    comFatores([{ id: "f1", factor_type: "totp", status: "verified" }]);
    expect(await isMfaEnrolled()).toBe(true);
    expect(listFactors).not.toHaveBeenCalled();
  });

  it("TOTP não verificado, ou fator de outro tipo, não conta", async () => {
    comFatores([
      { id: "f1", factor_type: "totp", status: "unverified" },
      { id: "f2", factor_type: "phone", status: "verified" },
    ]);
    expect(await isMfaEnrolled()).toBe(false);
  });

  it("GoTrue omite `factors` quando não há nenhum — isso é 'sem fator'", async () => {
    comFatores(undefined);
    expect(await isMfaEnrolled()).toBe(false);
  });

  it("com o AuthUser carregado, não fala com o GoTrue", async () => {
    const user = { id: "u-1", mfa_fator_verificado: true } as AuthUser;
    expect(await isMfaEnrolled(user)).toBe(true);
    expect(await isMfaEnrolled({ ...user, mfa_fator_verificado: false })).toBe(false);
    expect(getUser).not.toHaveBeenCalled();
    expect(listFactors).not.toHaveBeenCalled();
  });

  it("AuthUser sem o campo (montado fora do loadAuthUser) cai na pergunta, não em 'false'", async () => {
    comFatores([{ id: "f1", factor_type: "totp", status: "verified" }]);
    expect(await isMfaEnrolled({ id: "u-1" } as AuthUser)).toBe(true);
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it("mfaEmDivida sem fator não pergunta o AAL", async () => {
    const user = { id: "u-1", mfa_fator_verificado: false } as AuthUser;
    expect(await mfaEmDivida(user)).toBe(false);
    expect(getUser).not.toHaveBeenCalled();
  });
});

describe("fatores.ts", () => {
  it("devolve o fator TOTP verificado", () => {
    const f = { id: "f9", factor_type: "totp", status: "verified" };
    expect(fatorTotpVerificado({ factors: [{ id: "x", factor_type: "totp", status: "unverified" }, f] })).toBe(f);
    expect(temFatorTotpVerificado(null)).toBe(false);
  });
});
