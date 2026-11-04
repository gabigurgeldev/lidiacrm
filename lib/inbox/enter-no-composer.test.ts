import { describe, expect, it } from "vitest";

import { enterEnvia, ponteiroDeToque } from "./enter-no-composer";

describe("Enter no campo de mensagem", () => {
  it("no computador, Enter envia e Shift+Enter quebra linha", () => {
    expect(enterEnvia({ key: "Enter", shiftKey: false }, false)).toBe(true);
    expect(enterEnvia({ key: "Enter", shiftKey: true }, false)).toBe(false);
  });

  it("no celular (toque), Enter quebra linha — quem envia é o botão", () => {
    expect(enterEnvia({ key: "Enter", shiftKey: false }, true)).toBe(false);
  });

  it("outra tecla nunca envia", () => {
    expect(enterEnvia({ key: "a", shiftKey: false }, false)).toBe(false);
  });

  it("sem matchMedia (jsdom, SSR) o padrão é o do computador", () => {
    const original = window.matchMedia;
    // @ts-expect-error — simula ambiente sem matchMedia
    delete window.matchMedia;
    try {
      expect(ponteiroDeToque()).toBe(false);
    } finally {
      window.matchMedia = original;
    }
  });
});
