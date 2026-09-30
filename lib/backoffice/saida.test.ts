import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const envMock = vi.hoisted(() => ({
  BACKOFFICE_URL: "https://bo.test/",
  BACKOFFICE_API_KEY: "bo_live_teste",
}));
vi.mock("@/lib/env", () => ({ env: envMock }));

import {
  classificar,
  enviarPendentes,
  esperaDaTentativa,
  eventosDaCobranca,
  instanteDoPagamento,
  normalizarCodigo,
  precoComDesconto,
  validarCodigo,
} from "./saida";

const AGORA = new Date("2026-09-30T18:00:00.000Z"); // 15h em São Paulo

describe("código e preço", () => {
  it("normaliza o código como o Back Office", () => {
    expect(normalizarCodigo(" joao10 ")).toBe("JOAO10");
    expect(normalizarCodigo("ab")).toBeNull();
    expect(normalizarCodigo("com espaço")).toBeNull();
    expect(normalizarCodigo(undefined)).toBeNull();
  });

  it("aplica o desconto do afiliado sobre R$ 1.200", () => {
    expect(precoComDesconto(120000, 5000)).toBe(60000);
    expect(precoComDesconto(120000, 1250)).toBe(105000);
    expect(precoComDesconto(120000, null)).toBe(120000);
    expect(precoComDesconto(120000, 20000)).toBe(0);
  });
});

describe("cobrança do Asaas → eventos", () => {
  const base = { id: "pay_1", value: 600, billingType: "PIX", subscription: "sub_1" };

  it("paga vira payment.succeeded com valor em centavos e event_id estável", () => {
    const [e, ...resto] = eventosDaCobranca({ ...base, status: "RECEIVED", paymentDate: "2026-09-10" }, AGORA);
    expect(resto).toHaveLength(0);
    expect(e).toMatchObject({
      event_id: "crm_pay_pay_1_succeeded",
      type: "payment.succeeded",
      payment: { external_id: "pay_1", amount_cents: 60000, method: "pix", currency: "BRL" },
      subscription: { external_id: "sub_1" },
    });
    // CONFIRMED (cartão capturado) e depois RECEIVED: mesmo evento.
    expect(eventosDaCobranca({ ...base, status: "CONFIRMED", confirmedDate: "2026-09-10" }, AGORA)[0]!.event_id).toBe(
      e!.event_id,
    );
  });

  it("pendente ou vencida não gera nada", () => {
    expect(eventosDaCobranca({ ...base, status: "PENDING" }, AGORA)).toEqual([]);
    expect(eventosDaCobranca({ ...base, status: "OVERDUE" }, AGORA)).toEqual([]);
  });

  it("estornada leva o pagamento junto, e o estorno é total", () => {
    const ev = eventosDaCobranca({ ...base, status: "REFUNDED", paymentDate: "2026-09-10" }, AGORA);
    expect(ev.map((e) => e.type)).toEqual(["payment.succeeded", "payment.refunded"]);
    expect(ev[1]!.payment?.amount_cents).toBeUndefined();
  });

  it("chargeback (status efetivo do webhook) vira payment.chargeback", () => {
    const ev = eventosDaCobranca({ ...base, status: "CHARGEBACK", confirmedDate: "2026-09-10" }, AGORA);
    expect(ev.map((e) => e.type)).toEqual(["payment.succeeded", "payment.chargeback"]);
  });

  it("pagamento de hoje usa a hora real; de outro dia, meio da tarde de Brasília", () => {
    expect(instanteDoPagamento("2026-09-30", AGORA)).toBe(AGORA.toISOString());
    expect(instanteDoPagamento("2026-09-10", AGORA)).toBe("2026-09-10T15:00:00.000Z");
    expect(instanteDoPagamento(null, AGORA)).toBe(AGORA.toISOString());
  });
});

describe("envio", () => {
  it("classifica as respostas do Back Office", () => {
    expect(classificar(200)).toBe("enviado");
    expect(classificar(409)).toBe("enviado");
    expect(classificar(422)).toBe("definitivo");
    expect(classificar(401)).toBe("definitivo");
    expect(classificar(429)).toBe("reenviar");
    expect(classificar(503)).toBe("reenviar");
  });

  it("espera cresce e para em 1 hora", () => {
    expect(esperaDaTentativa(1)).toBe(60_000);
    expect(esperaDaTentativa(3)).toBe(4 * 60_000);
    expect(esperaDaTentativa(20)).toBe(60 * 60_000);
  });
});

/** Admin client falso: só o que `enviarPendentes` usa. */
function adminFalso(linhas: Array<Record<string, unknown>>) {
  const updates: Array<{ id: unknown; mudanca: Record<string, unknown> }> = [];
  const select = {
    eq: () => select,
    lte: () => select,
    order: () => select,
    in: () => select,
    limit: () => select,
    then: (r: (v: unknown) => unknown) => Promise.resolve({ data: linhas, error: null }).then(r),
  };
  const admin = {
    from: () => ({
      select: () => select,
      update: (mudanca: Record<string, unknown>) => ({
        eq: (_c: string, id: unknown) => ({
          eq: () => {
            updates.push({ id, mudanca });
            return Promise.resolve({ error: null });
          },
        }),
      }),
    }),
  };
  return { admin: admin as never, updates };
}

describe("enviarPendentes", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("assina com a chave do produto e marca como enviado", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    const payload = { event_id: "crm_pay_x_succeeded", type: "payment.succeeded" };
    const { admin, updates } = adminFalso([
      { id: "l1", event_id: "crm_pay_x_succeeded", payload, tentativas: 0, created_at: AGORA.toISOString() },
    ]);
    const r = await enviarPendentes(admin, { agora: AGORA });
    expect(r).toEqual({ enviados: 1, reagendados: 0, falharam: 0 });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://bo.test/api/v1/events");
    const h = init.headers as Record<string, string>;
    expect(h.authorization).toBe("Bearer bo_live_teste");
    const esperada = createHmac("sha256", "bo_live_teste").update(`${h["x-timestamp"]}.${init.body}`).digest("hex");
    expect(h["x-signature"]).toBe(`sha256=${esperada}`);
    expect(updates[0]!.mudanca).toMatchObject({ status: "enviado", tentativas: 1 });
  });

  it("5xx reagenda; 422 desiste; evento velho desiste", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("fora", { status: 503 }))
      .mockResolvedValueOnce(new Response("ruim", { status: 422 }))
      .mockResolvedValueOnce(new Response("fora", { status: 503 }));
    const velho = new Date(AGORA.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const { admin, updates } = adminFalso([
      { id: "a", event_id: "a", payload: {}, tentativas: 0, created_at: AGORA.toISOString() },
      { id: "b", event_id: "b", payload: {}, tentativas: 0, created_at: AGORA.toISOString() },
      { id: "c", event_id: "c", payload: {}, tentativas: 5, created_at: velho },
    ]);
    const r = await enviarPendentes(admin, { agora: AGORA });
    expect(r).toEqual({ enviados: 0, reagendados: 1, falharam: 2 });
    expect(updates[0]!.mudanca).not.toHaveProperty("status");
    expect(updates[0]!.mudanca.proxima_tentativa_em).toBe(new Date(AGORA.getTime() + 60_000).toISOString());
    expect(updates[1]!.mudanca).toMatchObject({ status: "falhou" });
    expect(updates[2]!.mudanca).toMatchObject({ status: "falhou" });
  });
});

describe("validarCodigo", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("válido devolve o desconto em bps", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ valid: true, code: "JOAO10", affiliate_name: "Agência X", discount_pct: 12.5, commission_pct: 30 }),
    );
    expect(await validarCodigo("joao10")).toEqual({
      estado: "valido",
      codigo: "JOAO10",
      descontoBps: 1250,
      nomeAfiliado: "Agência X",
    });
  });

  it("recusado pelo Back Office é inválido; fora do ar é indisponível", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ valid: false, code: "NADA" }));
    expect((await validarCodigo("NADA")).estado).toBe("invalido");
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect(await validarCodigo("JOAO10")).toEqual({ estado: "indisponivel", codigo: "JOAO10" });
  });
});
