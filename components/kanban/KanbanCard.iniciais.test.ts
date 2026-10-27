import { describe, expect, it } from "vitest";

import { iniciais } from "./KanbanCard";

describe("iniciais do avatar do card", () => {
  it("parte por espaço, não pela letra s", () => {
    expect(iniciais("Maria Souza")).toBe("MS");
    expect(iniciais("Sarah Silva Santos")).toBe("SS");
    expect(iniciais("  Joãozinho  ")).toBe("JO");
    expect(iniciais("")).toBe("?");
  });
});
