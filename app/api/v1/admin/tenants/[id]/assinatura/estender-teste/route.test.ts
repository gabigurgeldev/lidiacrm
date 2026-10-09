import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { invalidarAcesso, lerAssinatura } from "@/lib/billing/servico";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/v1/admin/tenants/[id]/assinatura/estender-teste
 *
 * O que se prova:
 *  - GATE: quem não é platform admin leva 403 e nada é lido nem gravado.
 *  - CORPO: dias fora de 1..365 é 422.
 *  - RECUSA: cancelada / paga / isenta é 409 e NÃO grava — gravar a data sem
 *    liberar nada faria o admin achar que liberou.
 *  - EFEITO: grava maior(agora, fim) + dias, invalida o cache de acesso e
 *    audita `billing.trial_estendido` com de/para.
 *  - ASAAS: com assinatura no Asaas, a resposta avisa que a cobrança não mudou.
 */

vi.mock("@/lib/auth/requirePlatformAdmin", () => ({ requirePlatformAdmin: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/billing/servico", () => ({ lerAssinatura: vi.fn(), invalidarAcesso: vi.fn() }));

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const AGORA = new Date("2026-10-09T12:00:00.000Z");

const updates: Array<{ valores: Record<string, unknown>; org: unknown }> = [];

function adminFalso() {
  return {
    from: (tabela: string) => {
      if (tabela !== "assinaturas") throw new Error(`tabela inesperada: ${tabela}`);
      return {
        update: (valores: Record<string, unknown>) => ({
          eq: async (_col: string, org: unknown) => {
            updates.push({ valores, org });
            return { error: null };
          },
        }),
      };
    },
  };
}

function assinatura(over: Record<string, unknown> = {}) {
  return {
    organization_id: ORG_ID,
    status: "trial",
    isenta: false,
    trial_termina_em: "2026-10-12T12:00:00.000Z",
    pago_ate: null,
    metodo: null,
    asaas_customer_id: null,
    asaas_subscription_id: null,
    cartao_final: null,
    cartao_bandeira: null,
    valor_centavos: 120000,
    cancelada_em: null,
    ...over,
  };
}

async function chamar(corpo: unknown) {
  const { POST } = await import("./route");
  const req = new NextRequest(`http://x/api/v1/admin/tenants/${ORG_ID}/assinatura/estender-teste`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpo),
  });
  return POST(req, { params: Promise.resolve({ id: ORG_ID }) });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AGORA);
  updates.length = 0;
  vi.mocked(audit).mockClear();
  vi.mocked(invalidarAcesso).mockClear();
  vi.mocked(lerAssinatura).mockReset();
  vi.mocked(requirePlatformAdmin).mockResolvedValue({ user: { id: ADMIN_ID } } as never);
  vi.mocked(createAdminClient).mockReturnValue(adminFalso() as never);
});

describe("estender teste grátis", () => {
  it("403 para quem não é platform admin, sem ler nem gravar", async () => {
    vi.mocked(requirePlatformAdmin).mockRejectedValue(new Error("NEXT_REDIRECT"));
    const res = await chamar({ dias: 7 });
    expect(res.status).toBe(403);
    expect(lerAssinatura).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it.each([0, 366, 2.5, "7"])("422 para dias = %s", async (dias) => {
    const res = await chamar({ dias });
    expect(res.status).toBe(422);
    expect(updates).toHaveLength(0);
  });

  it.each([
    ["cancelada", { status: "cancelada" }],
    ["paga", { status: "ativa", pago_ate: "2026-11-01T00:00:00.000Z" }],
    ["isenta", { isenta: true }],
  ])("409 quando %s, sem gravar", async (motivo, over) => {
    vi.mocked(lerAssinatura).mockResolvedValue(assinatura(over) as never);
    const res = await chamar({ dias: 7 });
    expect(res.status).toBe(409);
    const corpo = await res.json();
    expect(corpo.error.code).toBe("trial_extension_not_allowed");
    expect(corpo.error.details.motivo).toBe(motivo);
    expect(updates).toHaveLength(0);
    expect(audit).not.toHaveBeenCalled();
  });

  it("teste valendo: soma ao fim atual, invalida o cache e audita de/para", async () => {
    vi.mocked(lerAssinatura).mockResolvedValue(assinatura() as never);
    const res = await chamar({ dias: 7 });
    expect(res.status).toBe(200);
    const corpo = await res.json();
    expect(corpo.data).toMatchObject({
      trial_termina_em: "2026-10-19T12:00:00.000Z",
      status: "trial",
      aviso_asaas: false,
    });
    expect(updates).toEqual([
      {
        org: ORG_ID,
        valores: expect.objectContaining({ trial_termina_em: "2026-10-19T12:00:00.000Z", status: "trial" }),
      },
    ]);
    expect(invalidarAcesso).toHaveBeenCalledWith(ORG_ID);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "billing.trial_estendido",
        actorUserId: ADMIN_ID,
        organizationId: ORG_ID,
        actingAsPlatformAdmin: true,
        metadata: expect.objectContaining({
          de: "2026-10-12T12:00:00.000Z",
          para: "2026-10-19T12:00:00.000Z",
          dias: 7,
        }),
      }),
    );
  });

  it("teste vencido de quem nunca pagou: soma a hoje e volta a trial", async () => {
    vi.mocked(lerAssinatura).mockResolvedValue(
      assinatura({ status: "inadimplente", trial_termina_em: "2026-09-01T00:00:00.000Z" }) as never,
    );
    const corpo = await (await chamar({ dias: 15 })).json();
    expect(corpo.data).toMatchObject({ trial_termina_em: "2026-10-24T12:00:00.000Z", status: "trial" });
  });

  it("com assinatura no Asaas: grava e AVISA que a cobrança agendada não mudou", async () => {
    vi.mocked(lerAssinatura).mockResolvedValue(assinatura({ asaas_subscription_id: "sub_123" }) as never);
    const corpo = await (await chamar({ dias: 7 })).json();
    expect(corpo.data.aviso_asaas).toBe(true);
    expect(updates).toHaveLength(1);
  });

  it("404 quando a organização não existe", async () => {
    vi.mocked(lerAssinatura).mockResolvedValue(null);
    const res = await chamar({ dias: 7 });
    expect(res.status).toBe(404);
  });
});
