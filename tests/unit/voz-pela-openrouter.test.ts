import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as VoiceTranscode from "@/lib/messaging/media/voice-transcode";

/**
 * A voz do agente pelo Grok, com a chave da OpenRouter da organização.
 *
 * Por que existe: o Kokoro numa VPS de 2 núcleos levava ~9s por fala e, com os
 * 8 turnos paralelos do worker, a última fala estourava o timeout — além de
 * disputar CPU com o WAHA (medido em produção em 2026-10-01: o WhatsApp de
 * todas as organizações caiu). Pela OpenRouter, 8 falas simultâneas ficaram
 * prontas em ~3s, e cada organização paga a sua.
 *
 * O que é vigiado aqui, camada por camada:
 *   1. a regra de qual serviço fala (ambiente vence; sem ele, a chave da org);
 *   2. a voz pertence ao serviço (o default da coluna, `pf_dora`, não existe no Grok);
 *   3. o pedido HTTP ao Grok (URL, bearer, modelo, formato) e o mime devolvido;
 *   4. o mp3 vira ogg/opus antes de sair (canal `opus-only` recusa mp3);
 *   5. o envio do turno usa a voz DA ORGANIZAÇÃO quando o ambiente não tem serviço.
 */

const sendMessageHandler = vi.hoisted(() => vi.fn());
const insertInboxItem = vi.hoisted(() => vi.fn());
const paraNotaDeVozMock = vi.hoisted(() => vi.fn());

vi.mock("@/app/api/v1/messages/_handler", () => ({ sendMessageHandler }));
vi.mock("@/lib/agent-engine/db/repository", () => ({ insertInboxItem }));

const { servicoDeVoz, vozParaOServico } = await import("@/lib/ai/voz/vozes");
const { vozPelaOpenRouter, VOZ_PELA_OPENROUTER } = await import("@/lib/messaging/media/tts");
// A implementação REAL: o `vi.mock` lá embaixo (içado) troca o módulo para o envio.
const { paraNotaDeVoz } = await vi.importActual<typeof VoiceTranscode>(
  "@/lib/messaging/media/voice-transcode",
);
const { vozDaOrganizacaoPeloBanco } = await import("@/lib/agent-engine/edge/crm/voz-da-organizacao");

describe("servicoDeVoz", () => {
  it("o serviço da instalação (TTS_BASE_URL) vence", () => {
    expect(servicoDeVoz({ ttsBaseUrl: "http://kokoro:8880", chaveOpenRouter: true })).toBe("kokoro");
  });
  it("sem ele, a chave da OpenRouter faz a org falar pelo Grok", () => {
    expect(servicoDeVoz({ ttsBaseUrl: "  ", chaveOpenRouter: true })).toBe("grok");
    expect(servicoDeVoz({ ttsBaseUrl: undefined, chaveOpenRouter: true })).toBe("grok");
  });
  it("sem nenhum dos dois, não fala", () => {
    expect(servicoDeVoz({ ttsBaseUrl: "", chaveOpenRouter: false })).toBeNull();
  });
});

describe("vozParaOServico", () => {
  it("voz do Kokoro (inclusive o default da coluna) vira a padrão do Grok", () => {
    expect(vozParaOServico("pf_dora", "grok")).toBe("eve");
    expect(vozParaOServico("", "grok")).toBe("eve");
  });
  it("voz que já é do serviço passa intacta", () => {
    expect(vozParaOServico("rex", "grok")).toBe("rex");
    expect(vozParaOServico("pm_alex", "kokoro")).toBe("pm_alex");
    expect(vozParaOServico("eve", "kokoro")).toBe("pf_dora");
  });
});

describe("vozPelaOpenRouter", () => {
  it("pede ao Grok pela OpenRouter, com o bearer da org, em mp3", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const voz = vozPelaOpenRouter("sk-or-org", { TTS_MAX_CHARS: 500 }, fetchMock);
    expect(voz.servico).toBe("grok");
    expect(voz.maxChars).toBe(500);

    const out = await voz.provider.synthesize("Oi, tudo bem?", "eve");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://openrouter.ai/api/v1/audio/speech");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-or-org");
    expect(JSON.parse(init.body as string)).toEqual({
      model: VOZ_PELA_OPENROUTER.model,
      input: "Oi, tudo bem?",
      voice: "eve",
      response_format: "mp3",
    });
    expect(out.mime).toBe("audio/mpeg");
  });
});

describe("paraNotaDeVoz", () => {
  it("mp3 é reencodado em opus num contêiner ogg", async () => {
    const run = vi.fn(async (args: string[]) => {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(args[args.length - 1]!, Buffer.from("OggS"));
    });
    const out = await paraNotaDeVoz({ buffer: Buffer.from([1]), mime: "audio/mpeg" }, { run });
    expect(out.mime).toBe("audio/ogg");
    expect(out.buffer.toString()).toBe("OggS");
    expect(run.mock.calls[0]![0]).toEqual(expect.arrayContaining(["-c:a", "libopus", "-f", "ogg"]));
  });

  it("ogg/opus já serve: não chama o ffmpeg", async () => {
    const run = vi.fn();
    const out = await paraNotaDeVoz({ buffer: Buffer.from([7]), mime: "audio/ogg" }, { run });
    expect(run).not.toHaveBeenCalled();
    expect(out.buffer).toEqual(Buffer.from([7]));
  });

  it("conversão que falha LANÇA (quem chama manda texto + aviso)", async () => {
    const run = vi.fn().mockRejectedValue(new Error("ffmpeg_spawn_failed: ENOENT"));
    await expect(paraNotaDeVoz({ buffer: Buffer.from([1]), mime: "audio/mpeg" }, { run })).rejects.toThrow(
      /ffmpeg_spawn_failed/,
    );
  });
});

describe("vozDaOrganizacaoPeloBanco", () => {
  it("com chave da OpenRouter na org, fala pelo Grok", async () => {
    const resolver = vi.fn().mockResolvedValue({ apiKey: "sk-or-org" });
    const voz = await vozDaOrganizacaoPeloBanco({
      databaseUrl: "postgres://x/y",
      llmCfg: {} as never,
      tts: {},
      resolver: resolver as never,
    })("org-1");
    expect(voz?.servico).toBe("grok");
    expect(resolver.mock.calls[0]![2]).toBe("org-1");
    expect(resolver.mock.calls[0]![3]).toEqual({ provider: "openrouter" });
  });

  it("sem chave, null — e não lança", async () => {
    const resolver = vi.fn().mockRejectedValue(new Error("org sem credencial LLM utilizável"));
    const voz = await vozDaOrganizacaoPeloBanco({
      databaseUrl: "postgres://x/y",
      llmCfg: {} as never,
      tts: {},
      resolver: resolver as never,
    })("org-1");
    expect(voz).toBeNull();
  });
});

// ───────────────────── 5. o envio do turno, com a voz da org ───────────────

vi.mock("@/lib/messaging/media/voice-transcode", async (original) => ({
  ...(await original<typeof VoiceTranscode>()),
  paraNotaDeVoz: paraNotaDeVozMock,
}));
const { sendTurnMessage } = await import("@/lib/agent-engine/edge/crm/send-message");

function fakeDb() {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("insert into send_ledger")) return { rows: [{ id: "led-1" }] };
    if (sql.includes("select * from send_ledger")) return { rows: [{ id: "led-1", status: "requested" }] };
    return { rows: [] };
  });
  return { query } as never;
}

beforeEach(() => {
  sendMessageHandler.mockReset().mockResolvedValue({ id: "msg-1", status: "sent" });
  insertInboxItem.mockReset().mockResolvedValue(null);
  paraNotaDeVozMock.mockReset().mockResolvedValue({ buffer: Buffer.from("OggS"), mime: "audio/ogg" });
});

describe("sendTurnMessage sem TTS_BASE_URL", () => {
  it("fala pela chave da org: voz do Grok, mp3 convertido, nota de voz ogg", async () => {
    const synthesize = vi.fn().mockResolvedValue({ audio: Buffer.from([9]), mime: "audio/mpeg" });
    const upload = vi.fn().mockResolvedValue({ error: null });
    const vozDaOrganizacao = vi.fn().mockResolvedValue({ servico: "grok", provider: { synthesize }, maxChars: 800 });
    const cfg = { supabase: { storage: { from: vi.fn(() => ({ upload })) } }, voz: null, vozDaOrganizacao };

    const out = await sendTurnMessage(fakeDb(), cfg as never, {
      tenantId: "org-1",
      leadId: "lead-1",
      jobId: "job-1",
      seq: 1,
      conversationId: "conv-1",
      body: "Oi! Já vi o seu pedido.",
      // O default da coluna: tem de virar uma voz que o Grok conhece.
      voice: { voiceId: "pf_dora" },
    });

    expect(out.kind).toBe("sent");
    expect(vozDaOrganizacao).toHaveBeenCalledWith("org-1");
    expect(synthesize).toHaveBeenCalledWith("Oi! Já vi o seu pedido.", "eve");
    expect(paraNotaDeVozMock).toHaveBeenCalledWith({ buffer: Buffer.from([9]), mime: "audio/mpeg" });
    expect(upload).toHaveBeenCalledWith("org-1/conv-1/out-voz-led-1.ogg", Buffer.from("OggS"), {
      contentType: "audio/ogg",
      upsert: true,
    });
    const h = sendMessageHandler.mock.calls[0]![2] as { type: string; media_mime: string };
    expect(h.type).toBe("audio");
    expect(h.media_mime).toBe("audio/ogg");
  });

  it("conversão falhando: o lead recebe TEXTO e a Central o aviso", async () => {
    paraNotaDeVozMock.mockRejectedValue(new Error("ffmpeg_spawn_failed: ENOENT"));
    const synthesize = vi.fn().mockResolvedValue({ audio: Buffer.from([9]), mime: "audio/mpeg" });
    const cfg = {
      supabase: { storage: { from: vi.fn(() => ({ upload: vi.fn() })) } },
      voz: null,
      vozDaOrganizacao: vi.fn().mockResolvedValue({ servico: "grok", provider: { synthesize }, maxChars: 800 }),
    };

    const out = await sendTurnMessage(fakeDb(), cfg as never, {
      tenantId: "org-1",
      leadId: "lead-1",
      jobId: "job-1",
      seq: 1,
      conversationId: "conv-1",
      body: "Oi!",
      voice: { voiceId: "eve" },
    });

    expect(out.kind).toBe("sent");
    expect((sendMessageHandler.mock.calls[0]![2] as { type: string }).type).toBe("text");
    expect(insertInboxItem).toHaveBeenCalledTimes(1);
  });

  it("org sem chave: texto, e o aviso diz onde cadastrar", async () => {
    const cfg = {
      supabase: { storage: { from: vi.fn() } },
      voz: null,
      vozDaOrganizacao: vi.fn().mockResolvedValue(null),
    };
    await sendTurnMessage(fakeDb(), cfg as never, {
      tenantId: "org-1",
      leadId: "lead-1",
      jobId: "job-1",
      seq: 1,
      conversationId: "conv-1",
      body: "Oi!",
      voice: { voiceId: "eve" },
    });
    expect((sendMessageHandler.mock.calls[0]![2] as { type: string }).type).toBe("text");
    const aviso = insertInboxItem.mock.calls[0]![2] as { body: string };
    expect(aviso.body).toMatch(/OpenRouter/);
  });
});
