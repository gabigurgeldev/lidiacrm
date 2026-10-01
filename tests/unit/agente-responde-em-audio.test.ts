import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O agente responde em áudio (migration 0222).
 *
 * Três camadas, cada uma com o seu modo de falha:
 *
 *   1. o cliente HTTP do serviço de voz (dialeto OpenAI `/v1/audio/speech`) —
 *      o que vai no corpo, e que erro vira o quê;
 *   2. a preparação do texto — o que NÃO deve virar fala (link, e-mail, texto
 *      longo) e o que precisa sair limpo (marcação do WhatsApp, emoji);
 *   3. o envio do turno — a promessa central da feature: com a voz de pé a
 *      mensagem sai como nota de voz; com a voz fora, o lead recebe TEXTO e o
 *      operador recebe o aviso. Nunca silêncio.
 */

const sendMessageHandler = vi.hoisted(() => vi.fn());
const insertInboxItem = vi.hoisted(() => vi.fn());

vi.mock("@/app/api/v1/messages/_handler", () => ({ sendMessageHandler }));
vi.mock("@/lib/agent-engine/db/repository", () => ({ insertInboxItem }));

const { openAiCompatibleSpeechProvider, prepararFalaParaVoz, vozDoAmbiente, MIME_DA_VOZ } = await import(
  "@/lib/messaging/media/tts"
);
const { sendTurnMessage } = await import("@/lib/agent-engine/edge/crm/send-message");

// ─────────────────────────── 1. cliente HTTP ───────────────────────────────

describe("openAiCompatibleSpeechProvider", () => {
  it("POSTa em /v1/audio/speech com voz, texto e formato opus, e devolve ogg", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const provider = openAiCompatibleSpeechProvider({ baseUrl: "http://kokoro:8880/" }, fetchImpl);

    const out = await provider.synthesize("Oi, tudo bem?", "pf_dora");

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://kokoro:8880/v1/audio/speech");
    expect(JSON.parse(init.body as string)).toEqual({
      model: "kokoro",
      input: "Oi, tudo bem?",
      voice: "pf_dora",
      response_format: "opus",
    });
    // Sem timeout, um serviço pendurado segura a resposta do lead para sempre.
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(out.mime).toBe("audio/ogg");
    expect([...out.audio]).toEqual([1, 2, 3]);
  });

  it("status de erro vira tts_<status>", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("boom", { status: 503 }));
    const provider = openAiCompatibleSpeechProvider({ baseUrl: "http://kokoro:8880" }, fetchImpl);
    await expect(provider.synthesize("oi", "pf_dora")).rejects.toThrow("tts_503");
  });

  it("corpo vazio é falha, não nota de voz muda", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(new Uint8Array([]), { status: 200 }));
    const provider = openAiCompatibleSpeechProvider({ baseUrl: "http://kokoro:8880" }, fetchImpl);
    await expect(provider.synthesize("oi", "pf_dora")).rejects.toThrow("tts_audio_vazio");
  });
});

describe("vozDoAmbiente", () => {
  it("TTS_BASE_URL vazio ou só espaço = serviço não instalado", () => {
    expect(vozDoAmbiente({})).toBeNull();
    expect(vozDoAmbiente({ TTS_BASE_URL: "   " })).toBeNull();
  });

  it("com URL, monta o provedor e o teto de caracteres", () => {
    const voz = vozDoAmbiente({ TTS_BASE_URL: "http://kokoro:8880", TTS_MAX_CHARS: 500 });
    expect(voz?.maxChars).toBe(500);
    expect(typeof voz?.provider.synthesize).toBe("function");
  });
});

// ─────────────────────────── 2. preparação ─────────────────────────────────

describe("prepararFalaParaVoz", () => {
  it("tira marcação do WhatsApp e emoji", () => {
    expect(prepararFalaParaVoz("*Olá*, _tudo_ bem? 😊👍", 800)).toBe("Olá, tudo bem?");
  });

  it("link e e-mail vão em texto — ninguém copia endereço de um áudio", () => {
    expect(prepararFalaParaVoz("Veja em https://loja.com/produto", 800)).toBeNull();
    expect(prepararFalaParaVoz("Acesse www.loja.com", 800)).toBeNull();
    expect(prepararFalaParaVoz("Escreva para contato@loja.com", 800)).toBeNull();
  });

  it("acima do teto vai em texto", () => {
    expect(prepararFalaParaVoz("a".repeat(801), 800)).toBeNull();
    expect(prepararFalaParaVoz("a".repeat(800), 800)).toBe("a".repeat(800));
  });

  it("mensagem que é só emoji não vira áudio vazio", () => {
    expect(prepararFalaParaVoz("👍", 800)).toBeNull();
  });
});

// ─────────────────────────── 3. envio do turno ─────────────────────────────

function fakeDb(opts: { replayComMensagem?: boolean } = {}) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("insert into send_ledger")) {
      if (opts.replayComMensagem) throw Object.assign(new Error("dup"), { code: "23505" });
      return { rows: [{ id: "led-1" }] };
    }
    if (sql.includes("select * from send_ledger")) {
      return { rows: [{ id: "led-1", status: "requested" }] };
    }
    if (sql.includes("from messages")) {
      return { rows: opts.replayComMensagem ? [{ id: "msg-velha", status: "sent" }] : [] };
    }
    return { rows: [] };
  });
  return { query } as never;
}

function fakeCfg(voz: { synthesize?: ReturnType<typeof vi.fn> } | null) {
  const upload = vi.fn().mockResolvedValue({ error: null });
  const cfg = {
    supabase: { storage: { from: vi.fn(() => ({ upload })) } },
    voz: voz ? { servico: "kokoro", provider: { synthesize: voz.synthesize ?? vi.fn() }, maxChars: 800 } : null,
  };
  return { cfg: cfg as never, upload };
}

function entrada(extra: Record<string, unknown> = {}) {
  return {
    tenantId: "org-1",
    leadId: "lead-1",
    jobId: "job-1",
    seq: 1,
    conversationId: "conv-1",
    body: "Oi! Temos horário amanhã às 10h.",
    ...extra,
  };
}

function chamadaAoHandler() {
  return sendMessageHandler.mock.calls[0]?.[2] as {
    type: string;
    body: string;
    media_storage_path?: string;
    media_mime?: string;
    metadata: { idempotency_key: string; voz?: { voice: string; fallback?: string } };
  };
}

beforeEach(() => {
  sendMessageHandler.mockReset();
  sendMessageHandler.mockResolvedValue({ id: "msg-1", status: "sent" });
  insertInboxItem.mockReset();
  insertInboxItem.mockResolvedValue(null);
});

describe("sendTurnMessage com voz", () => {
  it("voz de pé: sobe a nota no Storage e envia type audio, com o texto como transcrição", async () => {
    const synthesize = vi.fn().mockResolvedValue({ audio: Buffer.from([9]), mime: MIME_DA_VOZ });
    const { cfg, upload } = fakeCfg({ synthesize });

    const out = await sendTurnMessage(fakeDb(), cfg, entrada({ voice: { voiceId: "pm_alex" } }));

    expect(out.kind).toBe("sent");
    expect(synthesize).toHaveBeenCalledWith("Oi! Temos horário amanhã às 10h.", "pm_alex");
    expect(upload).toHaveBeenCalledWith("org-1/conv-1/out-voz-led-1.ogg", Buffer.from([9]), {
      contentType: "audio/ogg",
      upsert: true,
    });
    const h = chamadaAoHandler();
    expect(h.type).toBe("audio");
    expect(h.media_storage_path).toBe("org-1/conv-1/out-voz-led-1.ogg");
    expect(h.media_mime).toBe("audio/ogg");
    expect(h.body).toBe("Oi! Temos horário amanhã às 10h.");
    expect(h.metadata.voz).toEqual({ voice: "pm_alex" });
    expect(insertInboxItem).not.toHaveBeenCalled();
  });

  it("síntese falha: o lead recebe TEXTO e a Central recebe o aviso", async () => {
    const synthesize = vi.fn().mockRejectedValue(new Error("tts_503"));
    const { cfg } = fakeCfg({ synthesize });

    const out = await sendTurnMessage(fakeDb(), cfg, entrada({ voice: { voiceId: "pf_dora" } }));

    expect(out.kind).toBe("sent");
    const h = chamadaAoHandler();
    expect(h.type).toBe("text");
    expect(h.media_storage_path).toBeUndefined();
    expect(h.metadata.voz?.fallback).toMatch(/^falha_na_sintese: tts_503/);
    expect(insertInboxItem).toHaveBeenCalledWith(
      expect.anything(),
      "org-1",
      expect.objectContaining({ kind: "voz_indisponivel", severity: "warn" }),
      "kind",
    );
  });

  it("upload falha: também cai para texto + aviso", async () => {
    const synthesize = vi.fn().mockResolvedValue({ audio: Buffer.from([9]), mime: MIME_DA_VOZ });
    const { cfg, upload } = fakeCfg({ synthesize });
    upload.mockResolvedValue({ error: { message: "bucket fora" } });

    await sendTurnMessage(fakeDb(), cfg, entrada({ voice: { voiceId: "pf_dora" } }));

    expect(chamadaAoHandler().type).toBe("text");
    expect(insertInboxItem).toHaveBeenCalledTimes(1);
  });

  it("serviço não instalado: texto + aviso dizendo o que falta", async () => {
    const { cfg } = fakeCfg(null);

    await sendTurnMessage(fakeDb(), cfg, entrada({ voice: { voiceId: "pf_dora" } }));

    expect(chamadaAoHandler().type).toBe("text");
    expect(chamadaAoHandler().metadata.voz?.fallback).toBe("servico_nao_configurado");
    const aviso = insertInboxItem.mock.calls[0]?.[2] as { body: string };
    expect(aviso.body).toContain("TTS_BASE_URL");
  });

  it("aviso que falha ao abrir não derruba o envio", async () => {
    insertInboxItem.mockRejectedValue(new Error("banco fora"));
    const { cfg } = fakeCfg({ synthesize: vi.fn().mockRejectedValue(new Error("tts_500")) });

    const out = await sendTurnMessage(fakeDb(), cfg, entrada({ voice: { voiceId: "pf_dora" } }));

    expect(out.kind).toBe("sent");
    expect(chamadaAoHandler().type).toBe("text");
  });

  it("mensagem com link vai em texto POR DESENHO — sem síntese e sem aviso", async () => {
    const synthesize = vi.fn();
    const { cfg } = fakeCfg({ synthesize });

    await sendTurnMessage(
      fakeDb(),
      cfg,
      entrada({ body: "Agende em https://agenda.com/x", voice: { voiceId: "pf_dora" } }),
    );

    expect(synthesize).not.toHaveBeenCalled();
    expect(chamadaAoHandler().type).toBe("text");
    expect(insertInboxItem).not.toHaveBeenCalled();
  });

  it("sem `voice`, nada muda: texto, sem síntese, sem metadata de voz", async () => {
    const synthesize = vi.fn();
    const { cfg } = fakeCfg({ synthesize });

    await sendTurnMessage(fakeDb(), cfg, entrada());

    expect(synthesize).not.toHaveBeenCalled();
    expect(chamadaAoHandler().type).toBe("text");
    expect(chamadaAoHandler().metadata.voz).toBeUndefined();
  });

  it("replay de mensagem que já saiu não paga outra síntese", async () => {
    const synthesize = vi.fn();
    const { cfg } = fakeCfg({ synthesize });

    const out = await sendTurnMessage(
      fakeDb({ replayComMensagem: true }),
      cfg,
      entrada({ voice: { voiceId: "pf_dora" } }),
    );

    expect(out.kind).toBe("sent");
    expect(synthesize).not.toHaveBeenCalled();
    expect(sendMessageHandler).not.toHaveBeenCalled();
  });
});
