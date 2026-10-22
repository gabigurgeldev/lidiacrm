import { describe, expect, it } from "vitest";

import {
  ACCEPT_DE_FOTO,
  FORMATOS_DE_FOTO,
  bytesConferemComOFormato,
  caminhoDeMaterialValido,
  eMimeDeFoto,
  pastaDeMateriais,
} from "./imagem";
import { aceitaArquivo, aceitaTextoColado, canonizarTipoDeFonte, eImagem } from "./tipos-de-fonte";

/**
 * As regras da foto que a tela, a rota de envio, a leitura e o agente dividem.
 *
 * `caminhoDeMaterialValido` é a trava que importa: quem assina a URL é a
 * service role, e o caminho vem de um jsonb que um manager escreve pela REST.
 * Cada caso recusado abaixo é um arquivo que, sem ela, o agente mandaria a um
 * cliente.
 */

const ORG = "22222222-2222-4222-8222-222222222222";
const OUTRA = "99999999-9999-4999-8999-999999999999";
const ARQ = "44444444-4444-4444-8444-444444444444";

describe("caminhoDeMaterialValido", () => {
  it.each(["jpg", "png", "webp"])("aceita uma foto .%s da pasta de materiais da org", (ext) => {
    expect(caminhoDeMaterialValido(`${ORG}/materiais/${ARQ}.${ext}`, ORG)).toBe(true);
  });

  it.each([
    ["outra organização", `${OUTRA}/materiais/${ARQ}.jpg`],
    ["pasta de conversa", `${ORG}/conversa-1/${ARQ}.jpg`],
    ["pasta de disparos", `${ORG}/disparos/${ARQ}.jpg`],
    ["subida com ..", `${ORG}/materiais/../${OUTRA}/materiais/${ARQ}.jpg`],
    ["subpasta dentro de materiais", `${ORG}/materiais/x/${ARQ}.jpg`],
    ["extensão errada", `${ORG}/materiais/${ARQ}.html`],
    ["extensão dupla", `${ORG}/materiais/${ARQ}.jpg.html`],
    ["jpeg por extenso", `${ORG}/materiais/${ARQ}.jpeg`],
    ["nome que não é uuid", `${ORG}/materiais/rosa.jpg`],
    ["barra inicial", `/${ORG}/materiais/${ARQ}.jpg`],
    // O `randomUUID` do Node é minúsculo; maiúscula só chega escrita à mão.
    ["uuid em maiúsculas", `${ORG}/materiais/ABCDEF01-2345-4678-9ABC-DEF012345678.jpg`],
  ])("recusa %s", (_rotulo, caminho) => {
    expect(caminhoDeMaterialValido(caminho, ORG)).toBe(false);
  });

  it("recusa o que não é texto", () => {
    expect(caminhoDeMaterialValido(undefined, ORG)).toBe(false);
    expect(caminhoDeMaterialValido(null, ORG)).toBe(false);
    expect(caminhoDeMaterialValido(42, ORG)).toBe(false);
  });

  it("org que não é uuid não vira regex (nada de `.*` vindo do argumento)", () => {
    expect(caminhoDeMaterialValido(`${ORG}/materiais/${ARQ}.jpg`, ".*")).toBe(false);
    expect(caminhoDeMaterialValido(`qualquer/materiais/${ARQ}.jpg`, "qualquer")).toBe(false);
  });

  it("a pasta que a rota de envio usa é a que a trava aceita", () => {
    expect(caminhoDeMaterialValido(`${pastaDeMateriais(ORG)}${ARQ}.webp`, ORG)).toBe(true);
  });
});

describe("bytesConferemComOFormato", () => {
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
  const HTML = new TextEncoder().encode("<!doctype html><script>");

  it("cada formato reconhece a própria assinatura", () => {
    expect(bytesConferemComOFormato(JPEG, "image/jpeg")).toBe(true);
    expect(bytesConferemComOFormato(PNG, "image/png")).toBe(true);
    expect(bytesConferemComOFormato(WEBP, "image/webp")).toBe(true);
  });

  it("assinatura de um formato não passa como outro", () => {
    expect(bytesConferemComOFormato(PNG, "image/jpeg")).toBe(false);
    expect(bytesConferemComOFormato(JPEG, "image/png")).toBe(false);
    expect(bytesConferemComOFormato(JPEG, "image/webp")).toBe(false);
  });

  it("HTML renomeado para foto é recusado", () => {
    expect(bytesConferemComOFormato(HTML, "image/jpeg")).toBe(false);
    expect(bytesConferemComOFormato(HTML, "image/png")).toBe(false);
    expect(bytesConferemComOFormato(HTML, "image/webp")).toBe(false);
  });

  it("RIFF que não é WEBP (um .wav, por exemplo) é recusado", () => {
    const WAV = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45]);
    expect(bytesConferemComOFormato(WAV, "image/webp")).toBe(false);
  });

  it("arquivo curto demais é recusado", () => {
    expect(bytesConferemComOFormato(new Uint8Array([0xff, 0xd8]), "image/jpeg")).toBe(false);
    expect(bytesConferemComOFormato(new Uint8Array([]), "image/png")).toBe(false);
  });
});

describe("formatos de foto", () => {
  it("só jpeg, png e webp", () => {
    expect(eMimeDeFoto("image/jpeg")).toBe(true);
    expect(eMimeDeFoto("image/png")).toBe(true);
    expect(eMimeDeFoto("image/webp")).toBe(true);
    expect(eMimeDeFoto("image/gif")).toBe(false);
    expect(eMimeDeFoto("image/svg+xml")).toBe(false);
    expect(eMimeDeFoto("toString")).toBe(false);
  });

  it("as extensões batem com as que a trava do caminho aceita", () => {
    expect(Object.values(FORMATOS_DE_FOTO).sort()).toEqual(["jpg", "png", "webp"]);
  });

  it("o accept do input é derivado dos formatos", () => {
    expect(ACCEPT_DE_FOTO.split(",").sort()).toEqual(Object.keys(FORMATOS_DE_FOTO).sort());
  });
});

describe("tipo de material `imagem`", () => {
  it.each(["imagem", "image", "foto", " Foto "])("'%s' canoniza para imagem", (bruto) => {
    expect(canonizarTipoDeFonte(bruto)).toBe("imagem");
  });

  it("é foto, e não recebe texto colado nem arquivo de documento", () => {
    expect(eImagem("imagem")).toBe(true);
    expect(eImagem("documento")).toBe(false);
    expect(aceitaTextoColado("imagem")).toBe(false);
    expect(aceitaArquivo("imagem")).toBe(false);
  });
});
