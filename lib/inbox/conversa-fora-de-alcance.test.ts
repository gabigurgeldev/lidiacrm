import { describe, expect, it } from "vitest";

import { conversaForaDeAlcance } from "./conversa-fora-de-alcance";

describe("conversaForaDeAlcance — recusa da 0252 vira 404, o resto não", () => {
  it("reconhece a recusa da fn_conversation_assign (42501 + conversation_not_visible)", () => {
    expect(conversaForaDeAlcance({ code: "42501", message: "conversation_not_visible" })).toBe(true);
  });

  it("NÃO engole o 'permission denied' genérico do Postgres (mesmo 42501)", () => {
    expect(
      conversaForaDeAlcance({
        code: "42501",
        message: "permission denied for function fn_conversation_assign",
      }),
    ).toBe(false);
  });

  it("NÃO reconhece a mensagem com outro código", () => {
    expect(conversaForaDeAlcance({ code: "P0001", message: "conversation_not_visible" })).toBe(false);
  });

  it("sem erro, sem recusa", () => {
    expect(conversaForaDeAlcance(null)).toBe(false);
    expect(conversaForaDeAlcance(undefined)).toBe(false);
  });
});
