import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Webhook do Asaas — a porta por onde "pagou" vira "liberado".
 *
 * O que se prova:
 *  - token errado ou ausente → 401, e nada é gravado;
 *  - evento repetido (23505 em eventos_asaas) → 200 SEM reprocessar;
 *  - PAYMENT_RECEIVED de uma assinatura nossa → grava a cobrança e recalcula
 *    (que é o que empurra `pago_ate` e libera);
 *  - a organização vem da SUBSCRIPTION gravada por nós; um `externalReference`
 *    apontando para outra org, sem o cliente Asaas bater, não alcança nada.
 */

vi.mock("@/lib/env", () => ({ env: { ASAAS_WEBHOOK_TOKEN: "segredo-do-webhook" } }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
const gravarCobranca = vi.fn(async () => undefined);
const recalcularAssinatura = vi.fn(async () => null);
vi.mock("@/lib/billing/servico", () => ({
  gravarCobranca: (...a: unknown[]) => gravarCobranca(...(a as [])),
  recalcularAssinatura: (...a: unknown[]) => recalcularAssinatura(...(a as [])),
}));

const ORG = "11111111-1111-4111-8111-111111111111";
const OUTRA = "22222222-2222-4222-8222-222222222222";

let inserirErro: { code: string } | null = null;
const inseridos: unknown[] = [];
const assinaturas = [{ organization_id: ORG, asaas_subscription_id: "sub_1", asaas_customer_id: "cus_1" }];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => {
      const filtros: Record<string, unknown> = {};
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = (c: string, v: unknown) => {
        filtros[c] = v;
        return b;
      };
      b.update = () => b;
      b.maybeSingle = async () => {
        if (tabela !== "assinaturas") return { data: null };
        const achada = assinaturas.find((a) =>
          Object.entries(filtros).every(([k, v]) => (a as Record<string, unknown>)[k] === v),
        );
        return { data: achada ? { organization_id: achada.organization_id } : null };
      };
      b.insert = async (linha: unknown) => {
        inseridos.push(linha);
        return { error: inserirErro };
      };
      b.then = (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res);
      return b;
    },
  }),
}));

function req(corpo: unknown, token: string | null = "segredo-do-webhook") {
  return new NextRequest("http://localhost/api/v1/webhooks/asaas", {
    method: "POST",
    body: JSON.stringify(corpo),
    headers: { "content-type": "application/json", ...(token ? { "asaas-access-token": token } : {}) },
  });
}

const pago = (over: Record<string, unknown> = {}) => ({
  id: "evt_1",
  event: "PAYMENT_RECEIVED",
  payment: {
    id: "pay_1",
    status: "RECEIVED",
    value: 1200,
    dueDate: "2026-10-10",
    billingType: "PIX",
    subscription: "sub_1",
    customer: "cus_1",
    ...over,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  inserirErro = null;
  inseridos.length = 0;
});

describe("POST /api/v1/webhooks/asaas", () => {
  it.each([["errado"], [null]])("token %s → 401 e nada gravado", async (token) => {
    const { POST } = await import("@/app/api/v1/webhooks/asaas/route");
    const res = await POST(req(pago(), token));
    expect(res.status).toBe(401);
    expect(inseridos).toHaveLength(0);
    expect(gravarCobranca).not.toHaveBeenCalled();
  });

  it("pagamento de assinatura nossa grava a cobrança e recalcula o acesso", async () => {
    const { POST } = await import("@/app/api/v1/webhooks/asaas/route");
    const res = await POST(req(pago()));
    expect(res.status).toBe(200);
    expect(gravarCobranca).toHaveBeenCalledWith(expect.anything(), ORG, expect.objectContaining({ id: "pay_1", status: "RECEIVED" }));
    expect(recalcularAssinatura).toHaveBeenCalledWith(expect.anything(), ORG);
  });

  it("evento REPETIDO (23505) volta 200 sem reprocessar", async () => {
    inserirErro = { code: "23505" };
    const { POST } = await import("@/app/api/v1/webhooks/asaas/route");
    const res = await POST(req(pago()));
    expect(res.status).toBe(200);
    expect(gravarCobranca).not.toHaveBeenCalled();
    expect(recalcularAssinatura).not.toHaveBeenCalled();
  });

  it("externalReference de OUTRA org sem o cliente bater não alcança ninguém", async () => {
    const { POST } = await import("@/app/api/v1/webhooks/asaas/route");
    const res = await POST(req(pago({ subscription: "sub_de_outro", externalReference: OUTRA, customer: "cus_x" })));
    expect(res.status).toBe(200);
    expect(gravarCobranca).not.toHaveBeenCalled();
  });

  it("chargeback grava a cobrança como CHARGEBACK (deixa de contar como paga)", async () => {
    const { POST } = await import("@/app/api/v1/webhooks/asaas/route");
    await POST(req({ ...pago(), id: "evt_2", event: "PAYMENT_CHARGEBACK_REQUESTED" }));
    expect(gravarCobranca).toHaveBeenCalledWith(expect.anything(), ORG, expect.objectContaining({ status: "CHARGEBACK" }));
  });
});
