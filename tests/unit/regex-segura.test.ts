/**
 * Padrão de regex escrito na tela: o que trava o worker é recusado ao salvar.
 *
 * JavaScript não tem timeout de regex; `(a+)+$` contra "aaaa…b" é backtracking
 * exponencial. O filtro de assunto do agente roda a cada mensagem que chega.
 *
 * Sabotagens medidas:
 *  - `riscoDeBacktracking` devolvendo sempre `null` ⇒ casos de aninhado e
 *    referência reversa vermelhos;
 *  - tirar o `superRefine` de `keyword_regex` em validation.ts ⇒ caso do Zod vermelho.
 */
import { describe, expect, it } from "vitest";

import { versionCreateSchema } from "@/lib/ai/agents/validation";
import { compilarSeguro, LIMITE_DO_PADRAO, problemaDoPadrao } from "@/lib/regex/segura";

describe("problemaDoPadrao", () => {
  it.each([
    "pedido|entrega|segunda via",
    "(?:pedido|entrega)",
    "\\bpedidos?\\b",
    "R\\$ ?\\d+",
    "[0-9]{3,5}",
    "(oi|ola)+",
    "boleto.*vencid",
    "(a+)?b",
  ])("aceita %s", (p) => {
    expect(problemaDoPadrao(p)).toBeNull();
  });

  it.each(["(a+)+$", "(\\w*\\s)*fim", "((ab)*c)+", "(x{2,})*", "([a-z]+)*@"])(
    "recusa quantificador sobre grupo que já repete: %s",
    (p) => {
      expect(problemaDoPadrao(p)).toBe("quantificador_aninhado");
    },
  );

  it("recusa referência reversa", () => {
    expect(problemaDoPadrao("(a)\\1")).toBe("referencia_reversa");
    expect(problemaDoPadrao("(?<x>a)\\k<x>")).toBe("referencia_reversa");
  });

  it("aceita dígito escapado dentro de classe (não é referência)", () => {
    expect(problemaDoPadrao("[\\d]+")).toBeNull();
  });

  it("recusa inválido, longo e vazio", () => {
    expect(problemaDoPadrao("pedido(")).toBe("invalido");
    expect(problemaDoPadrao("x".repeat(LIMITE_DO_PADRAO + 1))).toBe("longo_demais");
    expect(problemaDoPadrao("  ")).toBe("vazio");
  });

  it("compilarSeguro devolve null para o que foi recusado", () => {
    expect(compilarSeguro("(a+)+$")).toBeNull();
    expect(compilarSeguro("pedido")!.test("PEDIDO")).toBe(true);
  });
});

describe("validação da versão do agente", () => {
  const base = {
    system_prompt: "Você atende.",
    provider: "anthropic",
    model: "anthropic/claude-sonnet-4-6",
    credential_id: "00000000-0000-4000-8000-000000000001",
    channel_session_id: "00000000-0000-4000-8000-000000000002",
  };
  const comFiltro = (keyword_regex: string | null) => ({
    ...base,
    trigger_config: { filters: { keyword_regex } },
  });

  it("recusa ao salvar o padrão que trava o atendimento, com motivo em português", () => {
    const r = versionCreateSchema.safeParse(comFiltro("(a+)+$"));
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toMatch(/repete um trecho/);
  });

  it("aceita lista de palavras, vazio e null", () => {
    for (const v of ["pedido|entrega", "", null]) {
      const r = versionCreateSchema.safeParse(comFiltro(v));
      expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    }
  });
});
