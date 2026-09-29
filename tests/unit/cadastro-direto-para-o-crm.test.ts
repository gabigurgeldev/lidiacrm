/**
 * CADASTRO DE UMA TELA SÓ, DIRETO PARA O CRM.
 *
 * O cadastro pede nome, empresa, WhatsApp e aceite dos termos; a organização
 * nasce PRONTA (`onboarded_at` preenchido) e a pessoa cai em `/app/inbox`, sem
 * o assistente de 7 passos. Nos DOIS modos do Auth:
 *  - confirmação ligada: o clique no link (`/auth/confirm`) cria a org;
 *  - confirmação desligada (`ENABLE_EMAIL_AUTOCONFIRM=true`): o GoTrue devolve
 *    sessão no próprio cadastro, e era aqui que a org NUNCA era criada — a
 *    pessoa via "confirme seu e-mail" para um e-mail que não saía.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { normalizarWhatsapp, signupSchema } from "@/lib/auth/schemas";

const VALIDO = {
  full_name: "Ana Souza",
  org_name: "Clínica Bem Viver",
  whatsapp: "(11) 98765-4321",
  email: "ana@exemplo.com",
  password: "senha-forte-1",
  password_confirm: "senha-forte-1",
  aceite_termos: true,
};

describe("formulário de cadastro", () => {
  it("aceita o cadastro completo", () => {
    expect(signupSchema.safeParse(VALIDO).success).toBe(true);
  });

  it("exige nome, WhatsApp com DDD e o aceite dos termos", () => {
    const r = signupSchema.safeParse({ ...VALIDO, full_name: "", whatsapp: "98765-4321", aceite_termos: false });
    expect(r.success).toBe(false);
    const campos = r.success ? [] : r.error.issues.map((i) => i.path[0]);
    expect(campos).toEqual(expect.arrayContaining(["full_name", "whatsapp", "aceite_termos"]));
  });

  it("WhatsApp é guardado só em dígitos, com o 55 do Brasil", () => {
    expect(normalizarWhatsapp("(11) 98765-4321")).toBe("5511987654321");
    expect(normalizarWhatsapp("+55 11 3333-4444")).toBe("551133334444");
  });
});

const mocks = vi.hoisted(() => ({
  signUp: vi.fn(),
  ensureTenantForUser: vi.fn(async () => ({ provisioned: true, organizationId: "org-1" })),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ origin: "https://gestaltcrm.com.br" }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth/rate-limit", () => ({
  authRateLimited: vi.fn(async () => false),
  AUTH_LIMITS: { signup: { ip: 20, windowSec: 3600 } },
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined), hashEmail: () => "h" }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signUp: mocks.signUp } }),
}));
vi.mock("@/lib/auth/provision", () => ({ ensureTenantForUser: mocks.ensureTenantForUser }));

describe("ação de cadastro", () => {
  beforeEach(() => {
    mocks.signUp.mockReset();
    mocks.ensureTenantForUser.mockClear();
    mocks.redirect.mockClear();
  });

  it("guarda nome, WhatsApp, empresa e o aceite no user_metadata", async () => {
    mocks.signUp.mockResolvedValue({ data: { user: { id: "u1" }, session: null }, error: null });
    const { signUp } = await import("@/app/actions/auth/signUp");

    expect(await signUp(VALIDO)).toEqual({ ok: true });
    const opcoes = mocks.signUp.mock.calls[0]?.[0]?.options;
    expect(opcoes.emailRedirectTo).toBe("https://gestaltcrm.com.br/auth/confirm?type=signup");
    expect(opcoes.data).toMatchObject({
      org_name: "Clínica Bem Viver",
      full_name: "Ana Souza",
      phone: "5511987654321",
    });
    expect(Date.parse(opcoes.data.accepted_terms_at)).not.toBeNaN();
    // Confirmação LIGADA: a org só nasce no clique do link.
    expect(mocks.ensureTenantForUser).not.toHaveBeenCalled();
  });

  it("confirmação DESLIGADA: cria a organização na hora e entra no CRM", async () => {
    const user = { id: "u1", email: "ana@exemplo.com", user_metadata: {} };
    mocks.signUp.mockResolvedValue({ data: { user, session: { access_token: "x" } }, error: null });
    const { signUp } = await import("@/app/actions/auth/signUp");

    await expect(signUp(VALIDO)).rejects.toThrow("NEXT_REDIRECT:/app/inbox");
    expect(mocks.ensureTenantForUser).toHaveBeenCalledWith(user);
  });

  it("convidado com confirmação desligada vai para a tela de aceite, sem abrir empresa", async () => {
    mocks.signUp.mockResolvedValue({
      data: { user: { id: "u2" }, session: { access_token: "x" } },
      error: null,
    });
    vi.doMock("@/lib/auth/invite-token", () => ({
      verifyInviteToken: () => ({ email: "ana@exemplo.com" }),
    }));
    vi.resetModules();
    const { signUp } = await import("@/app/actions/auth/signUp");

    await expect(
      signUp({ email: "ana@exemplo.com", password: "senha-forte-1", password_confirm: "senha-forte-1" }, "tok"),
    ).rejects.toThrow("NEXT_REDIRECT:/team/accept-invite/tok");
    expect(mocks.ensureTenantForUser).not.toHaveBeenCalled();
    vi.doUnmock("@/lib/auth/invite-token");
  });
});

describe("a organização do cadastro nasce pronta", () => {
  const fonte = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("ensureTenantForUser grava onboarded_at no INSERT da organização", () => {
    const provision = fonte("lib/auth/provision.ts");
    const insert = provision.slice(provision.indexOf('.from("organizations")'));
    expect(insert.slice(0, insert.indexOf(".select("))).toContain("onboarded_at:");
  });

  it("/auth/confirm leva para o CRM, não para o assistente", () => {
    const rota = fonte("app/auth/confirm/route.ts");
    expect(rota).toContain('redirectTo("/app/inbox")');
    expect(rota).not.toContain('redirectTo("/onboarding/welcome")');
  });
});
