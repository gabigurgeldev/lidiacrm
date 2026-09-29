import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { chaveDoAsaas } from "@/lib/billing/asaas";
import { vencimentoDaPrimeira } from "@/lib/billing/checkout";

describe("chaveDoAsaas", () => {
  it("devolve o `$` que o operador tirou para o .env não expandir a chave", () => {
    expect(chaveDoAsaas("aact_hmlg_abc")).toBe("$aact_hmlg_abc");
    expect(chaveDoAsaas("$aact_prod_abc")).toBe("$aact_prod_abc");
    expect(chaveDoAsaas("  ")).toBe("");
  });
});

/**
 * Checkout da assinatura.
 *
 *  - quem assina DURANTE o teste não perde dias: a 1ª cobrança vence no fim dele;
 *  - cartão recusado vira 402 `payment_declined` com a mensagem do Asaas;
 *  - o número e o CVV do cartão NUNCA aparecem em audit nem na resposta —
 *    nem no sucesso, nem na recusa, nem na validação que falha.
 */

vi.mock("@/lib/auth/require-role", () => ({
  requireRole: vi.fn(async () => ({
    ok: true,
    user: { id: "u1" },
    org: { orgId: "11111111-1111-4111-8111-111111111111", name: "Org", role: "admin" },
  })),
}));
vi.mock("@/lib/auth/rate-limit", () => ({ authRateLimited: vi.fn(async () => false) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
const auditados: unknown[] = [];
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async (e: unknown) => void auditados.push(e)) }));
vi.mock("@/lib/billing/servico", () => ({ invalidarAcesso: vi.fn() }));

const iniciarCheckout = vi.fn();
vi.mock("@/lib/billing/checkout", async (orig) => ({
  ...(await orig<typeof import("@/lib/billing/checkout")>()),
  iniciarCheckout: (...a: unknown[]) => iniciarCheckout(...a),
}));
vi.mock("@/lib/billing/asaas", async (orig) => ({
  ...(await orig<typeof import("@/lib/billing/asaas")>()),
  cobrancaLigada: () => true,
}));

const NUMERO = "4111111111111111";
const CVV = "987";
const corpo = {
  metodo: "CREDIT_CARD",
  titular: {
    nome: "Maria Silva",
    cpfCnpj: "529.982.247-25",
    email: "maria@exemplo.com",
    telefone: "(11) 98765-4321",
    cep: "01310-100",
    numero: "100",
  },
  cartao: { numero: NUMERO, nome: "MARIA SILVA", mes: "12", ano: "2099", cvv: CVV },
};

function req(b: unknown) {
  return new NextRequest("http://localhost/api/v1/billing/checkout", {
    method: "POST",
    body: JSON.stringify(b),
    headers: { "content-type": "application/json" },
  });
}

function semCartao(texto: string) {
  expect(texto).not.toContain(NUMERO);
  expect(texto).not.toContain("4111 1111");
  expect(texto).not.toMatch(new RegExp(`"cvv"|\\b${CVV}\\b`));
}

beforeEach(() => {
  vi.clearAllMocks();
  auditados.length = 0;
});

describe("vencimentoDaPrimeira", () => {
  const agora = new Date("2026-10-03T15:00:00Z");
  it("em teste: vence no FIM do teste", () => {
    expect(vencimentoDaPrimeira({ trial_termina_em: "2026-10-08T15:00:00Z" }, agora)).toBe("2026-10-08");
  });
  it("teste vencido: vence hoje", () => {
    expect(vencimentoDaPrimeira({ trial_termina_em: "2026-10-01T15:00:00Z" }, agora)).toBe("2026-10-03");
  });
  it("sem teste: vence hoje", () => {
    expect(vencimentoDaPrimeira({ trial_termina_em: null }, agora)).toBe("2026-10-03");
  });
});

describe("POST /api/v1/billing/checkout", () => {
  it("aprovado: audita só os 4 últimos dígitos", async () => {
    iniciarCheckout.mockResolvedValue({ tipo: "cartao_aprovado", pagamentoId: "pay_1" });
    const { POST } = await import("@/app/api/v1/billing/checkout/route");
    const res = await POST(req(corpo));
    expect(res.status).toBe(200);
    const texto = JSON.stringify(auditados) + (await res.text());
    semCartao(texto);
    expect(JSON.stringify(auditados)).toContain('"cartao_final":"1111"');
  });

  it("recusado: 402 payment_declined com a mensagem do Asaas, sem o cartão", async () => {
    const { AsaasErro } = await import("@/lib/billing/asaas");
    iniciarCheckout.mockRejectedValue(new AsaasErro(400, "Transação não autorizada. Verifique os dados do cartão."));
    const { POST } = await import("@/app/api/v1/billing/checkout/route");
    const res = await POST(req(corpo));
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error.code).toBe("payment_declined");
    expect(body.error.message).toMatch(/não autorizada/);
    semCartao(JSON.stringify(body) + JSON.stringify(auditados));
  });

  it("validação que falha não devolve o valor recusado", async () => {
    const { POST } = await import("@/app/api/v1/billing/checkout/route");
    const res = await POST(req({ ...corpo, cartao: { ...corpo.cartao, numero: "4111111111111112" } }));
    expect(res.status).toBe(422);
    const texto = await res.text();
    expect(texto).not.toContain("4111111111111112");
    expect(iniciarCheckout).not.toHaveBeenCalled();
  });
});
