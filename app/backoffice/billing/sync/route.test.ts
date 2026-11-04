import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as Saida from "@/lib/backoffice/saida";

const envMock = vi.hoisted(() => ({
  BACKOFFICE_OUTBOUND_SECRET: "segredo_de_saida",
  BACKOFFICE_URL: "https://bo.test",
  BACKOFFICE_API_KEY: "bo_live_teste",
  NEXT_PUBLIC_APP_URL: "https://crm.test",
}));
vi.mock("@/lib/env", () => ({ env: envMock }));

const auditMock = vi.hoisted(() => vi.fn(async (_entrada: Record<string, unknown>) => {}));
vi.mock("@/lib/audit", () => ({ audit: auditMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

const sincronizarMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/backoffice/saida", async (importOriginal) => ({
  ...(await importOriginal<typeof Saida>()),
  sincronizarComBackoffice: sincronizarMock,
}));

import { assinar } from "@/lib/backoffice/assinatura";
import { codificarCursor } from "@/lib/backoffice/saida";

import { POST } from "./route";

const ORG = "11111111-1111-4111-8111-111111111111";

function pedido(corpo: string, segredo = envMock.BACKOFFICE_OUTBOUND_SECRET): Request {
  const ts = String(Math.floor(Date.now() / 1000));
  return new Request("https://crm.test/backoffice/billing/sync", {
    method: "POST",
    headers: { "x-timestamp": ts, "x-backoffice-signature": assinar(segredo, ts, corpo) },
    body: corpo,
  });
}

describe("POST /backoffice/billing/sync", () => {
  beforeEach(() => {
    auditMock.mockClear();
    sincronizarMock.mockReset();
    envMock.BACKOFFICE_URL = "https://bo.test";
  });

  it("sem a assinatura do Back Office: 401, e nada é lido", async () => {
    const res = await POST(pedido("{}", "outro_segredo"));
    expect(res.status).toBe(401);
    expect(sincronizarMock).not.toHaveBeenCalled();
  });

  it("primeira página (corpo vazio ou cursor nulo) responde o contrato e audita o efeito", async () => {
    const r = { invoices: 3, subscriptions: 0, enqueued: 3, sent: 2, next_cursor: "abc" };
    sincronizarMock.mockResolvedValue(r);
    for (const corpo of ["", "{}", '{"cursor":null}']) {
      const res = await POST(pedido(corpo));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(r);
    }
    expect(sincronizarMock).toHaveBeenCalledWith(expect.anything(), null);
    expect(auditMock).toHaveBeenCalledTimes(3);
    expect(auditMock.mock.calls[0]![0]).toMatchObject({
      action: "backoffice.sincronizacao_run",
      bypassedRls: true,
      metadata: { fase: "inicio", enqueued: 3, sent: 2, ultima_pagina: false },
    });
  });

  it("repassa o cursor decodificado; página que já tinha ido não audita", async () => {
    sincronizarMock.mockResolvedValue({ invoices: 1, subscriptions: 2, enqueued: 0, sent: 0, next_cursor: null });
    const cursor = { fase: "assinaturas" as const, organizacao: ORG };
    const res = await POST(pedido(JSON.stringify({ cursor: codificarCursor(cursor) })));
    expect(res.status).toBe(200);
    expect(sincronizarMock).toHaveBeenCalledWith(expect.anything(), cursor);
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("cursor que o CRM não emitiu, ou corpo inválido: 422", async () => {
    expect((await POST(pedido(JSON.stringify({ cursor: "lixo" })))).status).toBe(422);
    expect((await POST(pedido("não é json"))).status).toBe(422);
    expect((await POST(pedido(JSON.stringify({ cursor: 42 })))).status).toBe(422);
    expect(sincronizarMock).not.toHaveBeenCalled();
  });

  it("sem BACKOFFICE_URL/API_KEY o CRM não tem para onde mandar: 503", async () => {
    envMock.BACKOFFICE_URL = "";
    const res = await POST(pedido("{}"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "backoffice_outbound_not_configured" });
    expect(sincronizarMock).not.toHaveBeenCalled();
  });

  it("falha no meio: 500 sem auditar — o Back Office repete o mesmo cursor", async () => {
    sincronizarMock.mockRejectedValue(new Error("cobrancas: timeout"));
    const res = await POST(pedido("{}"));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "sync_failed" });
    expect(auditMock).not.toHaveBeenCalled();
  });
});
