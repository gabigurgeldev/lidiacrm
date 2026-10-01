/**
 * O vídeo do disparo é normalizado UMA vez, no upload, e sai sem pedir
 * conversão ao WAHA.
 *
 * O defeito (produção, 2026-10-01): `convert: true` fazia o WAHA reencodar o
 * vídeo inteiro em H.264 a cada destinatário. Dois disparos com vídeo empilharam
 * 8 reencodes simultâneos numa VPS de 2 núcleos, o WAHA bateu no teto de
 * memória e o WhatsApp de todas as organizações caiu.
 */
import { writeFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
  jaEhCompativel,
  paraVideoDoWhatsApp,
  SUFIXO_DE_VIDEO_PRONTO,
  videoJaPronto,
} from "@/lib/messaging/media/video-whatsapp";
import { wahaSendPlanFor } from "@/lib/waha/media-send";

const midia = { url: "https://signed.example/v.mp4?t=1", mime: "video/mp4" };

describe("wahaSendPlanFor com vídeo", () => {
  it("vídeo PRONTO sai sem pedir conversão", () => {
    expect(wahaSendPlanFor("video", { ...midia, pronto: true }).payload.convert).toBe(false);
  });
  it("vídeo sem marca (disparo antigo, inbox) segue pedindo — comportamento de antes", () => {
    expect(wahaSendPlanFor("video", midia).payload.convert).toBe(true);
  });
});

describe("videoJaPronto", () => {
  it("só o sufixo do upload normalizado conta", () => {
    expect(videoJaPronto(`org/disparos/abc${SUFIXO_DE_VIDEO_PRONTO}`)).toBe(true);
    expect(videoJaPronto("org/disparos/abc.mp4")).toBe(false);
    expect(videoJaPronto(null)).toBe(false);
  });
});

describe("jaEhCompativel", () => {
  const h264 = { codec_type: "video", codec_name: "h264", pix_fmt: "yuv420p" };
  it("H.264 yuv420p + AAC (o vídeo de celular comum) não precisa reencodar", () => {
    expect(jaEhCompativel([h264, { codec_type: "audio", codec_name: "aac" }])).toBe(true);
    expect(jaEhCompativel([h264])).toBe(true);
  });
  it("HEVC, yuv444 ou áudio opus precisam", () => {
    expect(jaEhCompativel([{ ...h264, codec_name: "hevc" }])).toBe(false);
    expect(jaEhCompativel([{ ...h264, pix_fmt: "yuv444p" }])).toBe(false);
    expect(jaEhCompativel([h264, { codec_type: "audio", codec_name: "opus" }])).toBe(false);
  });
});

function fakeRun(fluxos: object[]) {
  return vi.fn(async (bin: string, args: string[]) => {
    if (bin === "ffprobe") return JSON.stringify({ streams: fluxos });
    await writeFile(args[args.length - 1]!, Buffer.from("mp4"));
    return "";
  });
}

describe("paraVideoDoWhatsApp", () => {
  it("compatível: só troca o contêiner (-c copy + faststart), sem libx264", async () => {
    const run = fakeRun([{ codec_type: "video", codec_name: "h264", pix_fmt: "yuv420p" }]);
    const out = await paraVideoDoWhatsApp({ buffer: Buffer.from([1]) }, { run });
    const args = run.mock.calls[1]![1];
    expect(args).toEqual(expect.arrayContaining(["-c", "copy", "-movflags", "+faststart"]));
    expect(args).not.toContain("libx264");
    expect(out).toMatchObject({ mime: "video/mp4", reencodado: false });
  });

  it("incompatível: reencoda UMA vez para H.264/AAC", async () => {
    const run = fakeRun([{ codec_type: "video", codec_name: "hevc", pix_fmt: "yuv420p10le" }]);
    const out = await paraVideoDoWhatsApp({ buffer: Buffer.from([1]) }, { run });
    expect(run.mock.calls[1]![1]).toEqual(expect.arrayContaining(["libx264", "aac", "yuv420p"]));
    expect(out.reencodado).toBe(true);
  });

  it("falha LANÇA (o upload guarda o original, como antes)", async () => {
    const run = vi.fn().mockRejectedValue(new Error("ffprobe_spawn_failed: ENOENT"));
    await expect(paraVideoDoWhatsApp({ buffer: Buffer.from([1]) }, { run })).rejects.toThrow(/ffprobe/);
  });
});
