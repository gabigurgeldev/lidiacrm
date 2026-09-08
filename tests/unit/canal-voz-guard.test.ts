import { describe, expect, it } from "vitest";

import { capabilitiesOf, capabilitiesOfSession } from "@/lib/channels/capabilities";
import { ehVozOpus, motivoDeVozNaoEnviavel } from "@/lib/channels/voz";

describe("ehVozOpus", () => {
  it("aceita audio/ogg e audio/opus, com ou sem parâmetros", () => {
    expect(ehVozOpus("audio/ogg")).toBe(true);
    expect(ehVozOpus("audio/opus")).toBe(true);
    expect(ehVozOpus("audio/ogg;codecs=opus")).toBe(true);
    expect(ehVozOpus("AUDIO/OGG")).toBe(true);
  });

  it("recusa webm e outros contêineres", () => {
    expect(ehVozOpus("audio/webm")).toBe(false);
    expect(ehVozOpus("audio/webm;codecs=opus")).toBe(false);
    expect(ehVozOpus("audio/mp4")).toBe(false);
    expect(ehVozOpus("application/octet-stream")).toBe(false);
  });
});

describe("motivoDeVozNaoEnviavel", () => {
  const opusOnly = capabilitiesOf("meta_cloud"); // voiceNote: "opus-only"
  const serverConvert = capabilitiesOf("waha"); // voiceNote: "server-convert"

  it("barra áudio webm num canal opus-only, com motivo acionável", () => {
    const motivo = motivoDeVozNaoEnviavel(opusOnly, "audio", "audio/webm");
    expect(motivo).toBeTruthy();
    expect(motivo).toContain("ogg/opus");
    expect(motivo).toContain("ffmpeg");
  });

  it("deixa passar áudio já em ogg/opus num canal opus-only", () => {
    expect(motivoDeVozNaoEnviavel(opusOnly, "audio", "audio/ogg")).toBeNull();
    expect(motivoDeVozNaoEnviavel(opusOnly, "audio", "audio/opus")).toBeNull();
  });

  it("não morde canal que converte sozinho (server-convert): webm passa reto", () => {
    expect(motivoDeVozNaoEnviavel(serverConvert, "audio", "audio/webm")).toBeNull();
  });

  it("só olha áudio: imagem/documento nunca são barrados pelo formato de voz", () => {
    expect(motivoDeVozNaoEnviavel(opusOnly, "image", "image/webp")).toBeNull();
    expect(motivoDeVozNaoEnviavel(opusOnly, "document", "application/pdf")).toBeNull();
  });

  it("Stevo oficial é opus-only e barra webm; nenhuma modalidade dele converte", () => {
    const stevoOficial = capabilitiesOfSession({ provider: "stevo", mode: "oficial" });
    const stevoQr = capabilitiesOfSession({ provider: "stevo", mode: "qr" });
    expect(motivoDeVozNaoEnviavel(stevoOficial, "audio", "audio/webm")).toBeTruthy();
    expect(motivoDeVozNaoEnviavel(stevoQr, "audio", "audio/webm")).toBeTruthy();
    expect(motivoDeVozNaoEnviavel(stevoOficial, "audio", "audio/ogg")).toBeNull();
  });
});
