/**
 * TODO E-MAIL SAI NA MESMA CASCA, COM A MARCA — e chega.
 *
 * O que se guarda:
 *  1. O logo do e-mail é URL ABSOLUTA. O padrão do produto é `/gestalt-crm.png`
 *     (relativo, certo nas telas); num e-mail isso vira imagem quebrada no topo
 *     do primeiro contato com o sistema.
 *  2. Os e-mails do login deixam as variáveis do GoTrue CRUAS e montam o link
 *     com `&token_hash`, nunca um segundo `?` (ver
 *     `link-de-email-tem-uma-query-so.test.ts`).
 *  3. Com `EMAIL_SMTP_HOST` preenchido o envio vai por SMTP (Amazon SES), e o
 *     "não verificado" do SES tem nome próprio.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MarcaDeSaida } from "@/lib/branding/saida";
import { layoutDeEmail, logoDoEmail } from "@/lib/email/layout";
import {
  LINK_COM_TOKEN,
  TIPOS_DO_LOGIN,
  assuntoDoLogin,
  modeloDoLogin,
} from "@/lib/email/modelos-do-login";

const MARCA: MarcaDeSaida = {
  nome: "GestaltCRM",
  logoUrl: "/gestalt-crm.png",
  accent: "#506d48",
  accentFg: "#ffffff",
  origens: { nome: "padrao", cor: "padrao" },
};

describe("logo do e-mail", () => {
  it("caminho relativo vira absoluto contra o endereço do app", () => {
    expect(logoDoEmail("/gestalt-crm.png", "https://gestaltcrm.com.br")).toBe(
      "https://gestaltcrm.com.br/gestalt-crm.png",
    );
  });

  it("URL absoluta passa como está", () => {
    expect(logoDoEmail("https://cdn.x/logo.png", "https://app")).toBe("https://cdn.x/logo.png");
  });

  it("sem endereço do app, relativo NÃO vira <img> — o topo leva o nome", () => {
    expect(logoDoEmail("/gestalt-crm.png", null)).toBeNull();
    const html = layoutDeEmail({
      marca: MARCA,
      previa: "p",
      titulo: "t",
      corpoHtml: "",
      motivo: "m",
      baseDoApp: null,
    });
    expect(html).not.toContain("<img");
    expect(html).toContain("GestaltCRM");
  });

  it("esquema que não é http(s) é descartado", () => {
    expect(logoDoEmail("javascript:alert(1)", "https://app")).toBeNull();
    expect(logoDoEmail("//evil.test/x.png", "https://app")).toBeNull();
  });

  it("com endereço do app o <img> sai absoluto", () => {
    const html = layoutDeEmail({
      marca: MARCA,
      previa: "p",
      titulo: "t",
      corpoHtml: "",
      motivo: "m",
      baseDoApp: "https://gestaltcrm.com.br",
    });
    expect(html).toContain('src="https://gestaltcrm.com.br/gestalt-crm.png"');
    expect(html).not.toContain('src="/gestalt-crm.png"');
  });
});

describe("e-mails do login (GoTrue)", () => {
  it("todos os tipos renderizam com a marca e a cor do botão", () => {
    for (const tipo of TIPOS_DO_LOGIN) {
      const html = modeloDoLogin(tipo, MARCA, "https://gestaltcrm.com.br");
      expect(html, tipo).toContain("GestaltCRM");
      expect(html, tipo).toContain("#506d48");
      expect(html, tipo).toContain('src="https://gestaltcrm.com.br/gestalt-crm.png"');
      expect(assuntoDoLogin(tipo, "GestaltCRM"), tipo).toContain("GestaltCRM");
    }
  });

  it("confirmação e senha usam `{{ .RedirectTo }}&token_hash=` — UMA query só", () => {
    for (const tipo of ["confirmation", "recovery"] as const) {
      const html = modeloDoLogin(tipo, MARCA, "https://gestaltcrm.com.br");
      expect(html, tipo).toContain(`href="${LINK_COM_TOKEN}"`);
      expect(html, tipo).not.toMatch(/\{\{ \.RedirectTo \}\}\?/);
      // A variável NÃO pode ter sido escapada: o GoTrue não reconheceria.
      expect(html, tipo).not.toContain("&amp;token_hash");
    }
  });

  it("a reautenticação mostra o código, não um link", () => {
    const html = modeloDoLogin("reauthentication", MARCA, null);
    expect(html).toContain("{{ .Token }}");
    expect(html).not.toContain("{{ .RedirectTo }}");
  });

  it("a rota recusa tipo desconhecido e serve o modelo", async () => {
    vi.doMock("@/lib/branding/saida", async (orig) => ({
      ...(await orig<typeof import("@/lib/branding/saida")>()),
      marcaDaSaida: async () => MARCA,
    }));
    const { GET } = await import("@/app/email/modelos/[tipo]/route");
    const { NextRequest } = await import("next/server");
    const req = (u: string) => new NextRequest(u);

    const nao = await GET(req("https://x/email/modelos/qualquer"), {
      params: Promise.resolve({ tipo: "qualquer" }),
    });
    expect(nao.status).toBe(404);

    const sim = await GET(req("https://x/email/modelos/confirmation"), {
      params: Promise.resolve({ tipo: "confirmation" }),
    });
    expect(sim.status).toBe(200);
    expect(sim.headers.get("content-type")).toContain("text/html");
    expect(await sim.text()).toContain("{{ .TokenHash }}");

    const assunto = await GET(req("https://x/email/modelos/recovery?assunto=1"), {
      params: Promise.resolve({ tipo: "recovery" }),
    });
    expect(await assunto.text()).toBe("Redefinir sua senha — GestaltCRM");
    vi.doUnmock("@/lib/branding/saida");
  });
});

describe("envio por SMTP (Amazon SES)", () => {
  const CHAVES = ["EMAIL_SMTP_HOST", "EMAIL_SMTP_USER", "EMAIL_SMTP_PASS", "EMAIL_FROM", "RESEND_API_KEY", "RESEND_FROM_EMAIL"] as const;
  const originais = Object.fromEntries(CHAVES.map((k) => [k, process.env[k]]));
  const enviados: unknown[] = [];
  let falha: Error | null = null;

  beforeEach(() => {
    vi.resetModules();
    enviados.length = 0;
    falha = null;
    vi.doMock("nodemailer", () => ({
      default: {
        createTransport: () => ({
          sendMail: async (m: unknown) => {
            if (falha) throw falha;
            enviados.push(m);
            return { messageId: "<id@ses>" };
          },
        }),
      },
    }));
    process.env.EMAIL_SMTP_HOST = "email-smtp.sa-east-1.amazonaws.com";
    process.env.EMAIL_SMTP_USER = "AKIATESTE";
    process.env.EMAIL_SMTP_PASS = "segredo";
    process.env.EMAIL_FROM = "nao-responda@mail.gestaltcrm.com.br";
    process.env.RESEND_API_KEY = "";
  });

  afterEach(() => {
    for (const k of CHAVES) {
      if (originais[k] === undefined) delete process.env[k];
      else process.env[k] = originais[k];
    }
    vi.doUnmock("nodemailer");
    vi.resetModules();
  });

  it("com EMAIL_SMTP_HOST o e-mail sai por SMTP, com o nome da marca no remetente", async () => {
    const { sendEmail, isEmailConfigured } = await import("@/lib/email/resend");
    expect(isEmailConfigured()).toBe(true);
    const r = await sendEmail({ to: "a@b.com", subject: "s", html: "<p>x</p>", fromName: "GestaltCRM" });
    expect(r).toEqual({ ok: true, id: "<id@ses>" });
    expect(enviados[0]).toMatchObject({
      from: "GestaltCRM <nao-responda@mail.gestaltcrm.com.br>",
      to: "a@b.com",
      subject: "s",
    });
  });

  it("'not verified' do SES vira dominio_nao_verificado, não send_failed", async () => {
    falha = new Error("Message rejected: Email address is not verified.");
    const { sendEmail } = await import("@/lib/email/resend");
    const r = await sendEmail({ to: "a@b.com", subject: "s", html: "x" });
    expect(r.error).toBe("dominio_nao_verificado");
    expect(r.details).toContain("not verified");
  });

  it("sem remetente continua NÃO CONFIGURADO, mesmo com SMTP", async () => {
    process.env.EMAIL_FROM = "";
    process.env.RESEND_FROM_EMAIL = "";
    const { sendEmail } = await import("@/lib/email/resend");
    expect(await sendEmail({ to: "a@b.com", subject: "s", html: "x" })).toEqual({
      ok: false,
      error: "not_configured",
    });
    expect(enviados).toHaveLength(0);
  });
});
