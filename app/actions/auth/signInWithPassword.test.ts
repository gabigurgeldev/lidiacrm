/**
 * Issue #64 — o teto está LIGADO no login, não só disponível numa lib.
 *
 * O helper tem teste próprio (lib/auth/rate-limit.test.ts); este aqui prova a
 * fiação: a action recusa a 6ª tentativa contra a MESMA conta dentro da janela,
 * antes de falar com o GoTrue. Sem a chamada em signInWithPassword.ts, as seis
 * tentativas chegariam ao provedor e o teste fica vermelho.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  audit: vi.fn(async () => undefined),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const signIn = vi.fn(async () => ({
  data: { user: null, session: null },
  error: {
    name: "AuthApiError",
    message: "Invalid login credentials",
    status: 400,
    code: "invalid_credentials",
  },
}));

describe("signInWithPassword — teto de tentativas", () => {
  beforeEach(() => {
    vi.resetModules();
    signIn.mockClear();
    vi.mocked(headers).mockResolvedValue({
      get: (k: string) => (k === "x-forwarded-for" ? "203.0.113.77" : null),
    } as never);
    signIn.mockResolvedValue({
      data: { user: null, session: null },
      error: {
    name: "AuthApiError",
    message: "Invalid login credentials",
    status: 400,
    code: "invalid_credentials",
  },
    } as never);
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        signInWithPassword: signIn,
        mfa: { listFactors: vi.fn(async () => ({ data: { totp: [{ id: "f1" }] } })) },
      },
    } as never);
  });

  it("recusa a 6ª tentativa contra a mesma conta sem chamar o provedor", async () => {
    const { signInWithPassword } = await import("./signInWithPassword");
    const input = { email: "alvo@example.com", password: "senha-errada-123" };

    const resultados = [];
    for (let i = 0; i < 6; i++) {
      resultados.push(await signInWithPassword(input));
    }

    // AUTH_LIMITS.login.id = 5 → as 5 primeiras passam do teto e falham no
    // provedor; a 6ª nem chega lá.
    expect(resultados.slice(0, 5).map((r) => r.error)).toEqual(
      Array(5).fill("invalid_credentials"),
    );
    expect(resultados[5]?.error).toBe("rate_limited");
    expect(signIn).toHaveBeenCalledTimes(5);
  });

  it("acertar a senha não gasta o orçamento de bloqueio da conta", async () => {
    const { signInWithPassword } = await import("./signInWithPassword");
    const input = { email: "certo@example.com", password: "senha-certa-123" };

    // Provedor aceita, e a conta tem MFA — o retorno é mfa_required, o que
    // basta: o ponto é que o caminho de SUCESSO não incrementa o contador.
    signIn.mockResolvedValue({
      data: { user: { id: "u1" }, session: {} },
      error: null,
    } as never);

    const resultados = [];
    for (let i = 0; i < 10; i++) {
      resultados.push(await signInWithPassword(input));
    }

    // Nenhuma das dez foi barrada: se o sucesso contasse, a 6ª seria.
    expect(resultados.filter((r) => r?.error === "rate_limited")).toHaveLength(0);
    expect(signIn).toHaveBeenCalledTimes(10);
  });
});

/**
 * O GoTrue que NÃO RESPONDE não é senha errada. Medido em produção em
 * 2026-10-21: 349 respostas 504 em 10 minutos, cada uma virando "Email ou senha
 * incorretos." e uma tentativa no bloqueio de quem digitou a senha certa.
 */
describe("signInWithPassword — instabilidade não é senha errada", () => {
  beforeEach(() => {
    vi.resetModules();
    signIn.mockClear();
    vi.mocked(headers).mockResolvedValue({
      get: (k: string) => (k === "x-forwarded-for" ? "203.0.113.88" : null),
    } as never);
    vi.mocked(createClient).mockResolvedValue({
      auth: { signInWithPassword: signIn, mfa: { listFactors: vi.fn() } },
    } as never);
  });

  it.each([
    ["504 do gateway", { name: "AuthRetryableFetchError", message: "Gateway Timeout", status: 504 }],
    ["rede caída", { name: "AuthRetryableFetchError", message: "fetch failed", status: 0 }],
    ["500 do GoTrue", { name: "AuthApiError", message: "unexpected", status: 500 }],
  ])("%s devolve service_unavailable e NÃO conta tentativa", async (_rotulo, erro) => {
    const { signInWithPassword } = await import("./signInWithPassword");
    const input = { email: `instavel-${erro.status}@example.com`, password: "senha-certa-123" };
    signIn.mockResolvedValue({ data: { user: null, session: null }, error: erro } as never);

    const resultados = [];
    for (let i = 0; i < 8; i++) resultados.push(await signInWithPassword(input));

    // Oito falhas de serviço contra a mesma conta: se contassem, da 6ª em
    // diante viria rate_limited sem nem falar com o provedor.
    expect(resultados.map((r) => r.error)).toEqual(Array(8).fill("service_unavailable"));
    expect(signIn).toHaveBeenCalledTimes(8);

    // E a conta segue com o orçamento inteiro: a senha errada de verdade, a
    // seguir, ainda é dita como senha errada — não como bloqueio.
    signIn.mockResolvedValue({
      data: { user: null, session: null },
      error: { name: "AuthApiError", message: "Invalid login credentials", status: 400, code: "invalid_credentials" },
    } as never);
    expect((await signInWithPassword(input)).error).toBe("invalid_credentials");
  });

  it("fatores que vieram no login dispensam o listFactors", async () => {
    const { signInWithPassword } = await import("./signInWithPassword");
    const listFactors = vi.fn();
    vi.mocked(createClient).mockResolvedValue({
      auth: { signInWithPassword: signIn, mfa: { listFactors } },
    } as never);
    signIn.mockResolvedValue({
      data: {
        user: { id: "u1", factors: [{ id: "f7", factor_type: "totp", status: "verified" }] },
        session: {},
      },
      error: null,
    } as never);
    const r = await signInWithPassword({ email: "mfa@example.com", password: "senha-certa-123" });
    expect(r).toMatchObject({ error: "mfa_required", challengeId: "f7" });
    expect(listFactors).not.toHaveBeenCalled();
  });
});
