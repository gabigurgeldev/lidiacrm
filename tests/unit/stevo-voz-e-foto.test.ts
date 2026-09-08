import { afterEach, describe, expect, it, vi } from "vitest";

import { corpoDeEnvioStevo } from "@/lib/channels/stevo/envelope";
import { fetchFotoDePerfilStevo } from "@/lib/channels/stevo/perfil";
import type { OutboundEnvelope } from "@/lib/channels/types";

function envelope(over: Partial<OutboundEnvelope>): OutboundEnvelope {
  return {
    organizationId: "org",
    sessionRef: "inst",
    to: "5511999998888",
    kind: "text",
    ...over,
  } as OutboundEnvelope;
}

describe("corpoDeEnvioStevo — nota de voz", () => {
  it("áudio pede a bolha de voz (voice:true) e media_type audio", () => {
    const corpo = corpoDeEnvioStevo(
      envelope({ kind: "audio", media: { url: "https://x/a.ogg", mime: "audio/ogg" } }),
    );
    expect(corpo.media_type).toBe("audio");
    expect(corpo.voice).toBe(true);
  });

  it("imagem NÃO leva voice", () => {
    const corpo = corpoDeEnvioStevo(
      envelope({ kind: "image", media: { url: "https://x/a.jpg", mime: "image/jpeg" } }),
    );
    expect(corpo.media_type).toBe("image");
    expect(corpo.voice).toBeUndefined();
  });

  it("texto puro não leva mídia nem voice", () => {
    const corpo = corpoDeEnvioStevo(envelope({ kind: "text", body: "oi" }));
    expect(corpo.text).toBe("oi");
    expect(corpo.voice).toBeUndefined();
    expect(corpo.media_url).toBeUndefined();
  });
});

describe("fetchFotoDePerfilStevo — best-effort, nunca lança", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("devolve a URL quando o provedor responde com ela", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ profilePictureUrl: "https://cdn/pic.jpg" }), { status: 200 }),
      ),
    );
    const url = await fetchFotoDePerfilStevo({
      apiKey: "k",
      baseUrl: "https://api",
      instanceId: "i",
      numero: "5511999998888",
    });
    expect(url).toBe("https://cdn/pic.jpg");
  });

  it("devolve null em não-2xx (ex.: instância oficial sem foto)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    const url = await fetchFotoDePerfilStevo({
      apiKey: "k",
      baseUrl: "https://api",
      instanceId: "i",
      numero: "5511999998888",
    });
    expect(url).toBeNull();
  });

  it("devolve null quando a rede falha, sem lançar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    await expect(
      fetchFotoDePerfilStevo({ apiKey: "k", baseUrl: "https://api", instanceId: "i", numero: "5511" }),
    ).resolves.toBeNull();
  });
});
