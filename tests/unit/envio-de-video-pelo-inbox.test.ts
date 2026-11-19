/**
 * Vídeo pelo inbox sai — e não sai em dobro.
 *
 * O relato (cliente, 2026-11-19): "vídeo de 30 segundos ou de 14 minutos não
 * envia, dá erro; e tentar de novo também dá erro". Três defeitos em cadeia:
 *
 *   1. O upload do inbox guardava o vídeo como chegou, e o envio pedia ao WAHA
 *      `convert: true` — reencode do vídeo INTEIRO antes de mandar, a cada
 *      envio. O disparo já normalizava no upload; o inbox não.
 *   2. A tela esperava o envio por 10 s (padrão do `apiClient`) e o servidor
 *      espera o canal por 60 s. A tela desistia com o servidor ainda enviando.
 *   3. O toast genérico dizia "Tente novamente", e o arquivo ficava na janela:
 *      cada repetição virava outro vídeo no WhatsApp do cliente.
 *
 * Este arquivo cobre o lado do servidor e os números que amarram tela e canal.
 * O lado da tela (hook e composer) está em `envio-de-midia-na-tela.test.tsx`.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { PRAZO_DE_ENVIO_MS as PRAZO_STEVO } from "@/lib/channels/adapters/stevo";
import {
  emMegabytes,
  separarPeloTamanho,
} from "@/lib/inbox/enviar-lote";
import {
  envioSemResposta,
  PRAZO_DA_TELA_PARA_ENVIO_DE_MIDIA_MS,
  prazoDoEnvioNaTela,
} from "@/lib/inbox/prazo-do-envio";
import { prepararParaGuardar } from "@/lib/messaging/media/preparar-para-guardar";
import { MAX_MEDIA_BYTES } from "@/lib/messaging/media/types";
import { SUFIXO_DE_VIDEO_PRONTO, videoJaPronto } from "@/lib/messaging/media/video-whatsapp";
import { PRAZO_DO_ENVIO_MS as PRAZO_WAHA } from "@/lib/waha/client";
import { wahaSendPlanFor } from "@/lib/waha/media-send";

const original = Buffer.from("video-original");
const normalizado = Buffer.from("video-normalizado");

function deps(over: Partial<Parameters<typeof prepararParaGuardar>[1]> = {}) {
  return {
    normalizarVideo: vi.fn(async () => ({
      buffer: normalizado,
      mime: "video/mp4" as const,
      reencodado: false,
    })),
    transcodificarVoz: vi.fn(async (i: { buffer: Buffer; mime: string }) => ({
      buffer: i.buffer,
      mime: i.mime,
      convertido: false,
    })),
    aoNaoNormalizarVideo: vi.fn(),
    ...over,
  };
}

describe("prepararParaGuardar — o vídeo do inbox é normalizado no upload", () => {
  it("vídeo vira `.wa.mp4` em video/mp4, e o arquivo guardado é o normalizado", async () => {
    const d = deps();
    const r = await prepararParaGuardar({ buffer: original, mime: "video/quicktime", kind: "video" }, d);
    expect(r).toEqual({ buffer: normalizado, mime: "video/mp4", extensao: SUFIXO_DE_VIDEO_PRONTO });
    expect(d.normalizarVideo).toHaveBeenCalledWith({ buffer: original });
    expect(d.transcodificarVoz).not.toHaveBeenCalled();
  });

  it("o caminho que a rota monta com a extensão faz o envio pular a conversão do WAHA", async () => {
    const r = await prepararParaGuardar({ buffer: original, mime: "video/mp4", kind: "video" }, deps());
    const caminho = `org/conv/out-abc${r.extensao}`;
    expect(videoJaPronto(caminho)).toBe(true);
    const plano = wahaSendPlanFor("video", {
      url: "https://signed.example/v",
      mime: r.mime,
      pronto: videoJaPronto(caminho),
    });
    expect(plano.payload.convert).toBe(false);
  });

  it("normalização falhou: guarda o ORIGINAL, avisa quem chama, e o envio segue pedindo conversão", async () => {
    const d = deps({
      normalizarVideo: vi.fn(async () => {
        throw new Error("ffprobe_spawn_failed: ENOENT");
      }),
    });
    const r = await prepararParaGuardar({ buffer: original, mime: "video/mp4", kind: "video" }, d);
    expect(r).toEqual({ buffer: original, mime: "video/mp4", extensao: ".mp4" });
    expect(d.aoNaoNormalizarVideo).toHaveBeenCalledWith(expect.stringContaining("ffprobe_spawn_failed"));
    expect(videoJaPronto(`org/conv/out-abc${r.extensao}`)).toBe(false);
  });

  it("normalizado acima do teto do bucket: o original vale mais que nada", async () => {
    const d = deps({
      normalizarVideo: vi.fn(async () => ({
        buffer: Buffer.alloc(MAX_MEDIA_BYTES + 1),
        mime: "video/mp4" as const,
        reencodado: true,
      })),
    });
    const r = await prepararParaGuardar({ buffer: original, mime: "video/mp4", kind: "video" }, d);
    expect(r.buffer).toBe(original);
    expect(d.aoNaoNormalizarVideo).toHaveBeenCalledWith(expect.stringContaining("acima_do_teto"));
  });

  it("foto e documento não passam pelo ffmpeg de vídeo", async () => {
    const d = deps();
    const r = await prepararParaGuardar({ buffer: original, mime: "image/jpeg", kind: "image" }, d);
    expect(d.normalizarVideo).not.toHaveBeenCalled();
    expect(r).toEqual({ buffer: original, mime: "image/jpeg", extensao: ".jpg" });
  });

  it("nota de voz webm segue virando ogg — o que a rota já fazia antes", async () => {
    const ogg = Buffer.from("ogg");
    const d = deps({
      transcodificarVoz: vi.fn(async () => ({ buffer: ogg, mime: "audio/ogg", convertido: true })),
    });
    const r = await prepararParaGuardar({ buffer: original, mime: "audio/webm", kind: "audio" }, d);
    expect(r).toEqual({ buffer: ogg, mime: "audio/ogg", extensao: ".ogg" });
    expect(d.normalizarVideo).not.toHaveBeenCalled();
  });
});

describe("a rota de upload do inbox usa o preparo", () => {
  const fonte = readFileSync("app/api/v1/conversations/[id]/media/route.ts", "utf8");

  it("prepara com o TIPO validado, antes de guardar", () => {
    expect(fonte).toMatch(/prepararParaGuardar\(\s*\{\s*buffer:\s*bruto,\s*mime,\s*kind:\s*verdict\.kind\s*\}/);
    expect(fonte.indexOf("prepararParaGuardar(")).toBeLessThan(fonte.indexOf(".upload(storagePath"));
  });

  it("o caminho guardado leva a extensão do preparo (é ela que carrega o `.wa.mp4`)", () => {
    expect(fonte).toMatch(/out-\$\{randomUUID\(\)\}\$\{preparado\.extensao\}/);
  });
});

describe("a tela espera o envio de mídia mais que o servidor espera o canal", () => {
  it("o prazo da tela passa o do canal mais lento com folga para o resto do handler", () => {
    const folgaMinimaMs = 15_000;
    expect(PRAZO_DA_TELA_PARA_ENVIO_DE_MIDIA_MS).toBeGreaterThanOrEqual(
      Math.max(PRAZO_WAHA, PRAZO_STEVO) + folgaMinimaMs,
    );
  });

  it("só mídia ganha a espera longa; texto fica no padrão curto do apiClient", () => {
    expect(prazoDoEnvioNaTela({ media_storage_path: "org/conv/out-1.wa.mp4" })).toBe(
      PRAZO_DA_TELA_PARA_ENVIO_DE_MIDIA_MS,
    );
    expect(prazoDoEnvioNaTela({ media_url: "https://x/y.jpg" })).toBe(PRAZO_DA_TELA_PARA_ENVIO_DE_MIDIA_MS);
    expect(prazoDoEnvioNaTela({})).toBeUndefined();
  });
});

describe("envioSemResposta — quando o desfecho é desconhecido", () => {
  it("prazo da tela vencido e conexão caída contam", () => {
    expect(envioSemResposta(new DOMException("signal is aborted without reason", "AbortError"))).toBe(true);
    expect(envioSemResposta(new DOMException("timeout", "TimeoutError"))).toBe(true);
    expect(envioSemResposta(new TypeError("Failed to fetch"))).toBe(true);
  });

  it("resposta do servidor (mesmo de erro) não conta: aí o servidor disse o que houve", () => {
    expect(envioSemResposta(new Error("waha_500"))).toBe(false);
    expect(envioSemResposta({ status: 422, code: "validation_failed" })).toBe(false);
  });
});

describe("separarPeloTamanho — o teto por arquivo, na escolha", () => {
  const arquivo = (size: number) => ({ size });

  it("separa pelo teto da rota de upload, inclusive na borda", () => {
    const noTeto = arquivo(MAX_MEDIA_BYTES);
    const acima = arquivo(MAX_MEDIA_BYTES + 1);
    const pequeno = arquivo(10);
    expect(separarPeloTamanho([pequeno, acima, noTeto])).toEqual({
      cabem: [pequeno, noTeto],
      grandes: [acima],
    });
  });

  it("megabytes da frase: inteiro, para cima", () => {
    expect(emMegabytes(MAX_MEDIA_BYTES)).toBe(50);
    expect(emMegabytes(312 * 1024 * 1024 + 1)).toBe(313);
  });
});
