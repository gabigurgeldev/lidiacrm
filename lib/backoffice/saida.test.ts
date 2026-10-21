import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const envMock = vi.hoisted(() => ({
  BACKOFFICE_URL: "https://bo.test/",
  BACKOFFICE_API_KEY: "bo_live_teste",
  NEXT_PUBLIC_APP_URL: "https://crm.test/",
}));
vi.mock("@/lib/env", () => ({ env: envMock }));

import {
  classificar,
  conciliarTestesNoBackoffice,
  enviarPendentes,
  esperaDaTentativa,
  eventoDaAssinatura,
  eventosDaCobranca,
  instanteDoPagamento,
  normalizarCodigo,
  precoComDesconto,
  telefoneDoDono,
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

  const fatura = { ...base, dueDate: "2026-10-10", invoiceUrl: "https://www.asaas.com/i/abc" };

  it("pendente vira invoice.updated com vencimento, link, valor e método", () => {
    const ev = eventosDaCobranca({ ...fatura, status: "PENDING" }, AGORA);
    expect(ev).toEqual([
      {
        event_id: "crm_pay_pay_1_pending_2026-10-10",
        type: "invoice.updated",
        occurred_at: AGORA.toISOString(),
        invoice: {
          external_id: "pay_1",
          amount_cents: 60000,
          due_date: "2026-10-10",
          payment_url: "https://www.asaas.com/i/abc",
          status: "pending",
          method: "pix",
        },
        subscription: { external_id: "sub_1" },
      },
    ]);
  });

  it("vencida é outro estado; vencimento novo é outro evento", () => {
    const [vencida] = eventosDaCobranca({ ...fatura, status: "OVERDUE" }, AGORA);
    expect(vencida).toMatchObject({
      event_id: "crm_pay_pay_1_overdue_2026-10-10",
      invoice: { status: "overdue" },
    });
    const [adiada] = eventosDaCobranca({ ...fatura, status: "PENDING", dueDate: "2026-10-20" }, AGORA);
    expect(adiada!.event_id).toBe("crm_pay_pay_1_pending_2026-10-20");
  });

  it("excluída no Asaas vira fatura cancelada", () => {
    const ev = eventosDaCobranca({ ...fatura, status: "DELETED" }, AGORA);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ event_id: "crm_pay_pay_1_canceled", invoice: { status: "canceled" } });
  });

  it("paga leva o payment.succeeded E a fatura paga, com o MESMO id externo", () => {
    const ev = eventosDaCobranca({ ...fatura, status: "RECEIVED", paymentDate: "2026-10-09" }, AGORA);
    expect(ev.map((e) => e.type)).toEqual(["payment.succeeded", "invoice.updated"]);
    expect(ev[1]).toMatchObject({ event_id: "crm_pay_pay_1_paid", invoice: { status: "paid" } });
    expect(ev[1]!.invoice!.external_id).toBe(ev[0]!.payment!.external_id);
  });

  it("cartão leva method credit_card; link não-https e método desconhecido não vão", () => {
    const [cartao] = eventosDaCobranca({ ...fatura, status: "PENDING", billingType: "CREDIT_CARD" }, AGORA);
    expect(cartao!.invoice!.method).toBe("credit_card");
    const [outro] = eventosDaCobranca(
      { ...fatura, status: "PENDING", billingType: "UNDEFINED", invoiceUrl: "http://inseguro" },
      AGORA,
    );
    expect(outro!.invoice!.payment_url).toBeNull();
    expect(outro!.invoice).not.toHaveProperty("method");
  });

  it("sem vencimento, ou em estado que não é de fatura, não vira invoice.updated", () => {
    expect(eventosDaCobranca({ ...base, status: "PENDING" }, AGORA)).toEqual([]);
    expect(eventosDaCobranca({ ...fatura, status: "AWAITING_RISK_ANALYSIS" }, AGORA)).toEqual([]);
    const estorno = eventosDaCobranca({ ...fatura, status: "REFUNDED", paymentDate: "2026-09-10" }, AGORA);
    expect(estorno.map((e) => e.type)).toEqual(["payment.succeeded", "payment.refunded"]);
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

describe("assinatura → subscription.updated", () => {
  const ORG = "22222222-2222-4222-8222-222222222222";
  const base = {
    status: "trial",
    isenta: false,
    trial_termina_em: "2026-10-07T21:30:00.000Z", // 18h30 de 07/10 em São Paulo
    pago_ate: null,
    cancelada_em: null,
    valor_centavos: 120000,
    asaas_subscription_id: null,
  };

  it("teste leva o fim (dia de São Paulo) e o link de assinar; o event_id leva a data", () => {
    expect(eventoDaAssinatura(ORG, base, AGORA)).toEqual({
      event_id: `crm_org_${ORG}_sub_trial_2026-10-07`,
      type: "subscription.updated",
      occurred_at: AGORA.toISOString(),
      subscription: {
        status: "trial",
        trial_ends_at: "2026-10-07",
        subscribe_url: "https://crm.test/assinatura",
        amount_cents: 120000,
      },
    });
    // 01h UTC de 08/10 ainda é 07/10 em São Paulo.
    const tarde = eventoDaAssinatura(ORG, { ...base, trial_termina_em: "2026-10-08T01:00:00.000Z" }, AGORA);
    expect(tarde!.subscription!.trial_ends_at).toBe("2026-10-07");
  });

  it("teste estendido é evento novo", () => {
    const antes = eventoDaAssinatura(ORG, base, AGORA)!;
    const depois = eventoDaAssinatura(ORG, { ...base, trial_termina_em: "2026-10-14T21:30:00.000Z" }, AGORA)!;
    expect(depois.event_id).not.toBe(antes.event_id);
  });

  it("mapeia os status do CRM para os que o Back Office entende", () => {
    const ativa = eventoDaAssinatura(
      ORG,
      { ...base, status: "ativa", pago_ate: "2026-11-10T00:00:00.000Z", asaas_subscription_id: "sub_9" },
      AGORA,
    );
    expect(ativa).toMatchObject({
      event_id: `crm_org_${ORG}_sub_active_2026-11-09`,
      subscription: { status: "active", trial_ends_at: null, external_id: "sub_9" },
    });
    expect(eventoDaAssinatura(ORG, { ...base, status: "inadimplente" }, AGORA)).toMatchObject({
      event_id: `crm_org_${ORG}_sub_past_due_nunca_pagou`,
      subscription: { status: "past_due" },
    });
    expect(
      eventoDaAssinatura(ORG, { ...base, status: "cancelada", cancelada_em: "2026-09-30T15:00:00.000Z" }, AGORA),
    ).toMatchObject({ event_id: `crm_org_${ORG}_sub_canceled_2026-09-30`, subscription: { status: "canceled" } });
  });

  it("isenta e status desconhecido não saem", () => {
    expect(eventoDaAssinatura(ORG, { ...base, isenta: true }, AGORA)).toBeNull();
    expect(eventoDaAssinatura(ORG, { ...base, status: "outro" }, AGORA)).toBeNull();
  });
});

describe("telefone do dono", () => {
  it("só dígitos, de 10 a 13", () => {
    expect(telefoneDoDono("5511987654321")).toBe("5511987654321");
    expect(telefoneDoDono("+55 (11) 98765-4321")).toBe("5511987654321");
    expect(telefoneDoDono("11987654321")).toBe("11987654321");
    expect(telefoneDoDono("123")).toBeNull();
    expect(telefoneDoDono(undefined)).toBeNull();
    expect(telefoneDoDono(5511987654321)).toBeNull();
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

describe("conciliarTestesNoBackoffice", () => {
  const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const teste = (org: string, fim: string) => ({
    organization_id: org,
    status: "trial",
    isenta: false,
    trial_termina_em: fim,
    pago_ate: null,
    cancelada_em: null,
    valor_centavos: 120000,
    asaas_subscription_id: null,
  });

  /** Admin falso: assinaturas em teste, a fila com o que já foi, e o que é gravado. */
  function adminDaConciliacao(testes: Array<Record<string, unknown>>, jaNaFila: string[]) {
    const gravados: Array<Record<string, unknown>> = [];
    const filtros: Array<[string, unknown]> = [];
    const consulta = (linhas: () => unknown[]) => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "gte", "lte", "order", "limit", "not"]) {
        q[m] = (col: string, v: unknown) => {
          if (m === "eq" || m === "gte") filtros.push([col, v]);
          return q;
        };
      }
      // `in` é o último elo nas duas consultas à fila ("já está lá?" e o envio
      // logo depois de enfileirar), e as duas só querem saber dos ids pedidos.
      q.in = (_c: string, ids: string[]) => ({
        then: (r: (v: unknown) => unknown) =>
          Promise.resolve({
            data: jaNaFila.filter((id) => ids.includes(id)).map((event_id) => ({ event_id })),
            error: null,
          }).then(r),
      });
      q.maybeSingle = async () => ({ data: null, error: null });
      q.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: linhas(), error: null }).then(r);
      return q;
    };
    const admin = {
      from: (tabela: string) => {
        if (tabela === "assinaturas") return consulta(() => testes);
        if (tabela === "organizations" || tabela === "backoffice_indicacoes") return consulta(() => []);
        if (tabela === "backoffice_saida") {
          return {
            ...consulta(() => []),
            upsert: async (linhas: Array<Record<string, unknown>>) => {
              gravados.push(...linhas);
              return { error: null };
            },
          };
        }
        throw new Error(`tabela inesperada: ${tabela}`);
      },
    };
    return { admin: admin as never, gravados, filtros };
  }

  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("enfileira só o teste que ainda não foi, com a data de fim no event_id", async () => {
    const { admin, gravados, filtros } = adminDaConciliacao(
      [teste(ORG_A, "2026-10-03T12:00:00.000Z"), teste(ORG_B, "2026-10-05T12:00:00.000Z")],
      [`crm_org_${ORG_A}_sub_trial_2026-10-03`],
    );
    expect(await conciliarTestesNoBackoffice(admin, AGORA)).toBe(1);
    expect(gravados.map((g) => g.event_id)).toEqual([`crm_org_${ORG_B}_sub_trial_2026-10-05`]);
    expect(gravados[0]).toMatchObject({
      organization_id: ORG_B,
      tipo: "subscription.updated",
      payload: { product: "gestalt-crm", customer: { external_id: ORG_B } },
    });
    // Só teste em andamento (desde ontem, por causa do aviso do próprio dia) e não isento.
    expect(filtros).toEqual(
      expect.arrayContaining([
        ["status", "trial"],
        ["isenta", false],
        ["trial_termina_em", new Date(AGORA.getTime() - 24 * 60 * 60 * 1000).toISOString()],
      ]),
    );
  });

  it("tudo já na fila: não grava nada e devolve 0", async () => {
    const { admin, gravados } = adminDaConciliacao(
      [teste(ORG_A, "2026-10-03T12:00:00.000Z")],
      [`crm_org_${ORG_A}_sub_trial_2026-10-03`],
    );
    expect(await conciliarTestesNoBackoffice(admin, AGORA)).toBe(0);
    expect(gravados).toHaveLength(0);
  });
});
