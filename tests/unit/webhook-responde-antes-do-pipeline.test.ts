/**
 * O WEBHOOK DO WHATSAPP RESPONDE ANTES DE ANDAR O PIPELINE.
 *
 * A mensagem do cliente é gravada em milissegundos, mas o 200 ao provedor só
 * saía depois dos ticks de follow-up e do dreno de até 50 eventos (IA,
 * sentimento, mídia, fluxos). Por QR isso era segundos por mensagem: o provedor
 * estourava o tempo, reentregava, e as seguintes enfileiravam atrás — "demora
 * muito pra chegar no CRM".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { agendados, afterDisponivel, acelerar } = vi.hoisted(() => ({
  agendados: [] as Array<() => Promise<void>>,
  afterDisponivel: { valor: true },
  acelerar: vi.fn(async () => {}),
}));

vi.mock("next/server", () => ({
  after: (fn: () => Promise<void>) => {
    if (!afterDisponivel.valor) throw new Error("after() fora de request");
    agendados.push(fn);
  },
}));
vi.mock("@/lib/dev/kick-local-pipeline", () => ({ acelerarPipelineDeEventos: acelerar }));

import { depoisDaResposta } from "@/lib/channels/depois-da-resposta";

describe("depoisDaResposta", () => {
  beforeEach(() => {
    agendados.length = 0;
    acelerar.mockClear();
    afterDisponivel.valor = true;
  });

  it("dentro de request: agenda e volta SEM rodar o trabalho", async () => {
    const trabalho = vi.fn(async () => {});
    await depoisDaResposta("teste", trabalho);
    expect(trabalho).not.toHaveBeenCalled();
    expect(agendados).toHaveLength(1);
    await agendados[0]!();
    expect(trabalho).toHaveBeenCalledTimes(1);
  });

  it("fora de request (worker, script): roda na hora, como antes", async () => {
    afterDisponivel.valor = false;
    const trabalho = vi.fn(async () => {});
    await depoisDaResposta("teste", trabalho);
    expect(trabalho).toHaveBeenCalledTimes(1);
  });

  it("erro no trabalho adiado não sobe — a mensagem já está gravada", async () => {
    await depoisDaResposta("teste", async () => {
      throw new Error("drain caiu");
    });
    await expect(agendados[0]!()).resolves.toBeUndefined();
  });
});

describe("aplicarEfeitosPosEntrada", () => {
  it("o pipeline pesado vai para depois da resposta", async () => {
    agendados.length = 0;
    acelerar.mockClear();
    afterDisponivel.valor = true;
    vi.doMock("@/lib/leads/nascimento-do-lead", () => ({
      garantirLeadDaConversa: vi.fn(async () => ({ criado: false })),
    }));
    vi.doMock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
    const { aplicarEfeitosPosEntrada } = await import("@/lib/channels/pos-entrada");
    const inserir = vi.fn(async () => ({ error: null }));
    const cadeia = {
      insert: inserir,
      update: () => cadeia,
      eq: () => cadeia,
      select: () => cadeia,
      maybeSingle: async () => ({ data: null, error: null }),
    };
    const admin = { from: () => cadeia, rpc: async () => ({ data: null, error: null }) };

    await aplicarEfeitosPosEntrada(admin as never, {
      organizationId: "org",
      contactId: "ct",
      conversationId: "cv",
      messageId: "m1",
      channelSessionId: "s1",
      texto: "oi",
      nomeDoContato: null,
      origem: "teste",
    });

    expect(acelerar, "o pipeline rodou DENTRO do webhook").not.toHaveBeenCalled();
    expect(agendados.length).toBeGreaterThan(0);
    await agendados.at(-1)!();
    expect(acelerar).toHaveBeenCalledTimes(1);
  });
});
