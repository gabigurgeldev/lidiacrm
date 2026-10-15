import { describe, expect, it } from "vitest";

import { clienteMandouFoto } from "@/lib/agent-engine/agent/foto-do-cliente";

const foto = { direction: "inbound" as const, type: "image" };
const texto = { direction: "inbound" as const };
const nossa = { direction: "outbound" as const };
const nossaFoto = { direction: "outbound" as const, type: "image" };

describe("clienteMandouFoto", () => {
  it("foto do cliente neste turno → passa", () => {
    expect(clienteMandouFoto([nossa, foto])).toBe(true);
  });

  it("foto seguida de texto na mesma rajada ('vcs tem dessa??') → passa", () => {
    expect(clienteMandouFoto([nossa, foto, texto])).toBe(true);
  });

  it("foto já respondida por nós não passa a conversa de novo", () => {
    // Senão, depois que alguém devolve ao automático, toda mensagem seguinte
    // reencontraria a foto antiga no histórico e passaria de novo.
    expect(clienteMandouFoto([foto, nossa, texto])).toBe(false);
  });

  it("foto que NÓS mandamos não conta — o cliente escolhendo do catálogo fica com o agente", () => {
    expect(clienteMandouFoto([nossaFoto, texto])).toBe(false);
  });

  it("figurinha não é foto", () => {
    expect(clienteMandouFoto([nossa, { direction: "inbound", type: "sticker" }])).toBe(false);
  });

  it("histórico vazio ou só texto → não passa", () => {
    expect(clienteMandouFoto([])).toBe(false);
    expect(clienteMandouFoto([texto, texto])).toBe(false);
  });
});
