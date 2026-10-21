/**
 * "Sair" nunca termina na tela de erro: se a ação falha, vai para `/login`; se
 * a ação redireciona (o sucesso), a navegação dela não é engolida.
 */
import { describe, expect, it, vi } from "vitest";

import { sairComFallback } from "./sair";

describe("sairComFallback", () => {
  it("ação que falha (504, rede, chunk sumido) leva ao /login", async () => {
    const irPara = vi.fn();
    await sairComFallback(async () => {
      throw new Error("Failed to fetch");
    }, irPara);
    expect(irPara).toHaveBeenCalledWith("/login");
  });

  it("o redirect da própria ação é relançado, não trocado pelo fallback", async () => {
    const irPara = vi.fn();
    const redirecionou = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/login;307;",
    });
    await expect(
      sairComFallback(async () => {
        throw redirecionou;
      }, irPara),
    ).rejects.toBe(redirecionou);
    expect(irPara).not.toHaveBeenCalled();
  });

  it("ação que conclui não aciona o fallback", async () => {
    const irPara = vi.fn();
    await sairComFallback(async () => undefined, irPara);
    expect(irPara).not.toHaveBeenCalled();
  });
});
