import { describe, expect, it, vi } from "vitest";

import {
  apiTranscriptionProvider,
  escolherTranscricao,
  idiomaDaTranscricao,
  TRANSCRICAO_PELA_OPENROUTER,
  transcricaoParaATela,
} from "@/lib/messaging/media/transcription";

describe("apiTranscriptionProvider", () => {
  it("POSTa multipart pro endpoint de transcrição e devolve o texto", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: "olá, quero comprar" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const provider = apiTranscriptionProvider({ apiKey: "sk-test" }, fetchMock);
    const text = await provider.transcribe(Buffer.from([1, 2, 3]), "audio/ogg; codecs=opus");
    expect(text).toBe("olá, quero comprar");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/v1/audio/transcriptions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("propaga erro HTTP do provider", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("nope", { status: 401 }));
    const provider = apiTranscriptionProvider({ apiKey: "bad" }, fetchMock);
    await expect(provider.transcribe(Buffer.from([1]), "audio/ogg")).rejects.toThrow(/transcription_401/);
  });
});

describe("escolherTranscricao — a escada de chave", () => {
  it("com chave da OpenAI, usa a OpenAI no endpoint e modelo de sempre", () => {
    const e = escolherTranscricao({ openai: "sk-oa", openrouter: "sk-or" });
    expect(e).toEqual({ origem: "openai", creds: { apiKey: "sk-oa" } });
  });

  it("sem chave da OpenAI, cai na OpenRouter com base e modelo próprios", () => {
    const e = escolherTranscricao({ openai: null, openrouter: "sk-or" });
    expect(e?.origem).toBe("openrouter");
    expect(e?.creds).toEqual({ apiKey: "sk-or", ...TRANSCRICAO_PELA_OPENROUTER });
  });

  it("sem nenhuma das duas, devolve null (quem chama abre o aviso)", () => {
    expect(escolherTranscricao({ openai: null, openrouter: null })).toBeNull();
  });

  it("pela OpenRouter, o POST vai para openrouter.ai com o modelo prefixado", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: "oi" }), { status: 200 }),
    );
    const e = escolherTranscricao({ openai: null, openrouter: "sk-or" })!;
    await apiTranscriptionProvider(e.creds, fetchMock).transcribe(Buffer.from([1]), "audio/ogg; codecs=opus");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://openrouter.ai/api/v1/audio/transcriptions");
    expect((init.body as FormData).get("model")).toBe("openai/gpt-4o-mini-transcribe");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-or");
  });
});

describe("transcricaoParaATela", () => {
  it("nunca anuncia o modelo de conversa: mostra o modelo que transcreve", () => {
    expect(transcricaoParaATela({ openai: true, openrouter: true }).modelId).toBe("whisper-1");
    expect(transcricaoParaATela({ openai: false, openrouter: true }).modelId).toBe(
      "openai/gpt-4o-mini-transcribe",
    );
  });

  it("sem chave nenhuma, avisa em vez de parecer configurado", () => {
    const t = transcricaoParaATela({ openai: false, openrouter: false });
    expect(t.modelId).toBeNull();
    expect(t.aviso).toMatch(/OpenRouter/);
  });
});

describe("idioma da transcrição", () => {
  // Produção, 2026-10-08: áudio em português transcrito em tailandês, porque o
  // pedido não dizia o idioma e o modelo adivinhou pelo áudio.
  it("manda o idioma no multipart quando há um", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ text: "oi" }), { status: 200 }));
    const p = apiTranscriptionProvider({ apiKey: "k", language: "pt" }, fetchImpl as unknown as typeof fetch);
    await p.transcribe(Buffer.from([1, 2, 3]), "audio/ogg; codecs=opus");
    const form = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
    expect(form.get("language")).toBe("pt");
  });

  it("sem idioma, o campo não vai (o modelo detecta sozinho, como antes)", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ text: "oi" }), { status: 200 }));
    const p = apiTranscriptionProvider({ apiKey: "k" }, fetchImpl as unknown as typeof fetch);
    await p.transcribe(Buffer.from([1, 2, 3]), "audio/ogg");
    const form = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
    expect(form.has("language")).toBe(false);
  });

  it("deriva o idioma do locale da organização, sem inventar", () => {
    expect(idiomaDaTranscricao("pt-BR")).toBe("pt");
    expect(idiomaDaTranscricao("es")).toBe("es");
    expect(idiomaDaTranscricao("en_US")).toBe("en");
    expect(idiomaDaTranscricao(null)).toBeUndefined();
    expect(idiomaDaTranscricao("português")).toBeUndefined();
  });
});
