/**
 * A pré-checagem do teto faz a MESMA pergunta que a cadeia de envio.
 *
 * Desde o PR #34, o `pacingGate` não aplica o aquecimento a quem RESPONDE um
 * contato que escreveu nas últimas 24 h (`respondeAoContato`). A pré-checagem
 * do turno (`tetoDoNumeroAtingido`) roda ANTES do modelo e adia o turno inteiro:
 * se ela ignorasse esse campo, adiaria para amanhã a resposta que o envio
 * deixaria passar agora — o conserto do teto viraria o defeito que o #34 tirou.
 *
 * O invariante `teto-do-numero-adia-e-avisa` prova o mesmo contra Postgres real;
 * este arquivo existe para a sabotagem ser medida sem banco.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PACING_DEFAULTS } from "@/lib/agent-engine/pacing/defaults";

const AGORA = new Date("2026-07-28T18:00:00Z");
const ONTEM = new Date(AGORA.getTime() - 86_400_000);

const estado = { ultimaEntrada: null as Date | null, enviadosHoje: 0 };

vi.mock("@/lib/agent-engine/pacing/store", () => ({
  loadChannelKnobs: async () => ({ knobs: PACING_DEFAULTS, numberActivatedAt: ONTEM }),
  loadPacingState: async () => ({ lastSentAt: null, sentToday: estado.enviadosHoje, numberActivatedAt: ONTEM }),
}));

vi.mock("@/lib/agent-engine/guardrails/before-send", () => ({
  loadChannelIdentity: async () => ({ provider: "waha", mode: null }),
  readLastInboundAt: async () => estado.ultimaEntrada,
}));

const { tetoDoNumeroAtingido } = await import("@/lib/agent-engine/agent/teto-do-numero");

function confere() {
  return tetoDoNumeroAtingido({} as never, {
    tenantId: "org",
    channelSessionId: "sessao",
    contactId: "contato",
    now: AGORA,
  });
}

beforeEach(() => {
  estado.ultimaEntrada = null;
  estado.enviadosHoje = 20;
});

describe("tetoDoNumeroAtingido — quem o aquecimento alcança", () => {
  it("número de um dia, no teto, falando com quem não escreveu há pouco: adia", async () => {
    estado.ultimaEntrada = new Date(AGORA.getTime() - 3 * 86_400_000);
    expect(await confere()).toMatchObject({ code: "warmup_cap" });
  });

  it("contato que nunca escreveu: adia (a janela fechada é a direção segura)", async () => {
    expect(await confere()).toMatchObject({ code: "warmup_cap" });
  });

  it("o MESMO número no teto, respondendo a quem escreveu agora: segue", async () => {
    estado.ultimaEntrada = new Date(AGORA.getTime() - 60_000);
    expect(await confere()).toBeNull();
  });

  it("abaixo do teto: segue", async () => {
    estado.enviadosHoje = 3;
    estado.ultimaEntrada = new Date(AGORA.getTime() - 3 * 86_400_000);
    expect(await confere()).toBeNull();
  });
});
