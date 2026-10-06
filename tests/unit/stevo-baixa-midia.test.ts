/**
 * `baixarMidiaStevo` — o baixador da mídia de ENTRADA da conta Stevo.
 *
 * Sem ele o worker de mídia pulava toda mídia da Stevo ("canal_sem_midia_de_entrada")
 * e o áudio do cliente nunca era guardado nem transcrito. O link vem do payload,
 * então o que se prova aqui é o contorno: nenhuma credencial vai junto, 3xx não
 * é seguido, destino privado é recusado, e o mime da resposta manda.
 */
import { describe, expect, it, vi } from "vitest";

import { baixarMidiaStevo } from "@/lib/channels/stevo/midia";
import { MediaTooLargeError } from "@/lib/messaging/media/types";

const URL_OK = "https://hel1.your-objectstorage.com/stevo/media/x/audio.ogg";
const destinoOk = async () => {};

function resposta(status: number, corpo: Uint8Array | string, cabecalhos: Record<string, string> = {}) {
  return new Response(corpo as unknown as BodyInit, { status, headers: cabecalhos });
}

describe("baixarMidiaStevo", () => {
  it("baixa, devolve os bytes e o mime DA RESPOSTA, sem mandar credencial nem seguir redirect", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.redirect).toBe("manual");
      expect(init?.headers).toBeUndefined();
      return resposta(200, new Uint8Array([1, 2, 3]), { "content-type": "audio/ogg; codecs=opus" });
    });
    const m = await baixarMidiaStevo(URL_OK, "audio/mpeg", { fetchImpl: fetchImpl as unknown as typeof fetch, conferirDestino: destinoOk });
    expect([...m.buffer]).toEqual([1, 2, 3]);
    expect(m.mime).toBe("audio/ogg");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("sem content-type na resposta, usa a dica do webhook", async () => {
    const fetchImpl = async () => resposta(200, new Uint8Array([9]));
    const m = await baixarMidiaStevo(URL_OK, "video/mp4", { fetchImpl: fetchImpl as unknown as typeof fetch, conferirDestino: destinoOk });
    expect(m.mime).toBe("video/mp4");
  });

  it("3xx é recusado — não segue para um host que nenhuma guarda viu", async () => {
    const fetchImpl = async () => resposta(302, "", { location: "http://169.254.169.254/" });
    await expect(
      baixarMidiaStevo(URL_OK, null, { fetchImpl: fetchImpl as unknown as typeof fetch, conferirDestino: destinoOk }),
    ).rejects.toThrow(/stevo_media_redirect: 302/);
  });

  it("status de erro vira erro com o código (o worker tenta de novo e, na última, marca failed)", async () => {
    const fetchImpl = async () => resposta(404, "nao");
    await expect(
      baixarMidiaStevo(URL_OK, null, { fetchImpl: fetchImpl as unknown as typeof fetch, conferirDestino: destinoOk }),
    ).rejects.toThrow(/stevo_media_failed: 404/);
  });

  it("destino que resolve para rede privada é recusado ANTES do fetch", async () => {
    const fetchImpl = vi.fn();
    await expect(
      baixarMidiaStevo(URL_OK, null, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        conferirDestino: async () => {
          throw new Error("destino_privado");
        },
      }),
    ).rejects.toThrow(/destino_privado/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("esquema ou host literal privado é recusado pela guarda textual", async () => {
    await expect(baixarMidiaStevo("file:///etc/passwd", null, { conferirDestino: destinoOk })).rejects.toThrow();
    await expect(baixarMidiaStevo("https://127.0.0.1/x", null, { conferirDestino: destinoOk })).rejects.toThrow();
  });

  it("content-length acima do teto recusa sem ler o corpo", async () => {
    const fetchImpl = async () => resposta(200, new Uint8Array([1]), { "content-length": String(60 * 1024 * 1024) });
    await expect(
      baixarMidiaStevo(URL_OK, null, { fetchImpl: fetchImpl as unknown as typeof fetch, conferirDestino: destinoOk }),
    ).rejects.toBeInstanceOf(MediaTooLargeError);
  });
});
