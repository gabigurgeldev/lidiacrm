/**
 * "ESQUECI A SENHA" SAI PELO CRM, COM A MARCA.
 *
 * No Supabase do EasyPanel o Auth não recebe `GOTRUE_MAILER_TEMPLATES_*` (compose
 * fixo), e o e-mail saía com o texto cru do Supabase. O CRM agora pede só o link
 * ao Auth e envia ele mesmo, pelo SES.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateLink, sendEmail } = vi.hoisted(() => ({
  generateLink: vi.fn(),
  sendEmail: vi.fn(async () => ({ ok: true, id: "m1" })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ auth: { admin: { generateLink } } }),
}));
vi.mock("@/lib/email/resend", () => ({ sendEmail }));
vi.mock("@/lib/branding/saida", async (original) => ({
  ...(await original<typeof import("@/lib/branding/saida")>()),
  marcaDaSaida: async () => ({
    nome: "Gestalt CRM",
    logoUrl: null,
    accent: "#1f9d3a",
    accentFg: "#ffffff",
  }),
}));

import { comLinkReal, enviarRecuperacaoPeloApp } from "@/lib/auth/email-de-recuperacao";
import { LINK_COM_TOKEN } from "@/lib/email/modelos-do-login";

const REDIRECT = "https://gestaltcrm.com.br/auth/confirm?type=recovery";

describe("recuperação de senha pelo app", () => {
  beforeEach(() => {
    generateLink.mockReset();
    sendEmail.mockClear();
  });

  it("envia o e-mail da marca com o link /auth/confirm?type=recovery&token_hash=…", async () => {
    generateLink.mockResolvedValue({
      data: { properties: { hashed_token: "abc123" } },
      error: null,
    });
    expect(await enviarRecuperacaoPeloApp("ana@exemplo.com", REDIRECT)).toBe("enviado");

    const args = (sendEmail.mock.calls[0] as unknown[])[0] as { html: string; to: string; subject: string };
    expect(args.to).toBe("ana@exemplo.com");
    expect(args.subject).toContain("Gestalt CRM");
    expect(args.html).toContain(`href="${REDIRECT.replace("&", "&amp;")}&amp;token_hash=abc123"`);
    // Nenhum marcador do GoTrue sobra no e-mail que sai daqui.
    expect(args.html).not.toContain("{{");
  });

  it("e-mail sem conta: neutro, sem enviar nada (não vira oráculo)", async () => {
    generateLink.mockResolvedValue({
      data: null,
      error: { status: 404, message: "User not found" },
    });
    expect(await enviarRecuperacaoPeloApp("ninguem@exemplo.com", REDIRECT)).toBe("sem_conta");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("falha no envio devolve 'falhou' — quem chama cai no envio do Supabase", async () => {
    generateLink.mockResolvedValue({ data: { properties: { hashed_token: "x" } }, error: null });
    sendEmail.mockResolvedValueOnce({ ok: false, error: "send_failed" } as never);
    expect(await enviarRecuperacaoPeloApp("ana@exemplo.com", REDIRECT)).toBe("falhou");
  });

  it("comLinkReal troca TODAS as ocorrências do marcador", () => {
    const html = `<a href="${LINK_COM_TOKEN}">x</a> ${LINK_COM_TOKEN}`;
    expect(comLinkReal(html, "https://a.b/c?x=1&y=2")).not.toContain("{{");
  });
});
