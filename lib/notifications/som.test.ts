import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./sounds", () => ({ playSound: vi.fn() }));

import { playSound } from "./sounds";
import {
  _reiniciarSomParaTeste,
  definirSomDeAviso,
  grupoTocouHaPouco,
  somDeAvisoLigado,
  tocarAviso,
} from "./som";

describe("tocarAviso", () => {
  beforeEach(() => {
    _reiniciarSomParaTeste();
    window.localStorage.clear();
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("vem ligado: quem nunca mexeu ouve", async () => {
    expect(somDeAvisoLigado()).toBe(true);
    expect(await tocarAviso({ som: "message", chave: "m1" })).toBe(true);
    expect(playSound).toHaveBeenCalledWith("message", 1);
  });

  it("desligado pela pessoa: não toca", async () => {
    definirSomDeAviso(false);
    expect(await tocarAviso({ som: "message", chave: "m1" })).toBe(false);
    expect(playSound).not.toHaveBeenCalled();
  });

  it("o mesmo assunto não toca de novo dentro da janela", async () => {
    expect(await tocarAviso({ som: "message", chave: "m1", grupo: "contato:c1", janelaMs: 10_000 })).toBe(true);
    expect(await tocarAviso({ som: "message", chave: "m2", grupo: "contato:c1", janelaMs: 10_000 })).toBe(false);
    expect(await tocarAviso({ som: "message", chave: "m3", grupo: "contato:c2", janelaMs: 10_000 })).toBe(true);
    expect(playSound).toHaveBeenCalledTimes(2);
    expect(grupoTocouHaPouco("contato:c1", 10_000)).toBe(true);
    expect(grupoTocouHaPouco("contato:c1", 10_000, Date.now() + 11_000)).toBe(false);
  });

  it("várias abas, um evento: com Web Locks só a primeira toca", async () => {
    // Um lock manager compartilhado — o que as abas reais compartilham.
    const ocupados = new Set<string>();
    vi.stubGlobal("navigator", {
      locks: {
        request: async (
          nome: string,
          _o: unknown,
          cb: (lock: unknown) => Promise<void>,
        ) => {
          if (ocupados.has(nome)) return cb(null);
          ocupados.add(nome);
          void cb({ name: nome });
        },
      },
    });
    const abas = await Promise.all([
      tocarAviso({ som: "message", chave: "evt-1" }),
      tocarAviso({ som: "message", chave: "evt-1" }),
      tocarAviso({ som: "message", chave: "evt-1" }),
    ]);
    expect(abas.filter(Boolean)).toHaveLength(1);
    expect(playSound).toHaveBeenCalledTimes(1);
  });

  it("sem Web Locks: o claim no localStorage segura a segunda aba", async () => {
    vi.stubGlobal("navigator", {});
    expect(await tocarAviso({ som: "message", chave: "evt-2" })).toBe(true);
    expect(await tocarAviso({ som: "message", chave: "evt-2" })).toBe(false);
    expect(playSound).toHaveBeenCalledTimes(1);
  });
});
