import { describe, expect, it } from "vitest";

import { ehRoteador, separarModelos } from "./roteadores";

const m = (provider: string, model_id: string, display_name = model_id) => ({ provider, model_id, display_name });

// Os sete roteadores medidos no catálogo de produção (2026-10-10), mais vizinhos
// que NÃO são roteadores e têm nomes parecidos.
const catalogo = [
  m("openrouter", "anthropic/claude-haiku-5.5", "Claude Haiku 5.5"),
  m("openrouter", "typesafe/jev-router", "JEV Router"),
  m("openrouter", "openrouter/auto", "Auto Router"),
  m("openrouter", "openrouter/fusion"),
  m("openrouter", "openrouter/pareto-code"),
  m("openrouter", "openai/gpt-oss-safeguard-20b", "GPT OSS Safeguard"),
  m("openrouter", "meta-llama/llama-guard-4-12b", "Llama Guard 4"),
];

describe("ehRoteador", () => {
  it("reconhece os endereços da OpenRouter e os de terceiros que se declaram router", () => {
    expect(ehRoteador(m("openrouter", "openrouter/auto"))).toBe(true);
    expect(ehRoteador(m("openrouter", "typesafe/jev-router"))).toBe(true);
    expect(ehRoteador(m("openrouter", "openrouter/fusion"))).toBe(true);
  });

  it("não confunde modelo comum com roteador", () => {
    expect(ehRoteador(m("openrouter", "anthropic/claude-haiku-5.5"))).toBe(false);
    expect(ehRoteador(m("openrouter", "meta-llama/llama-guard-4-12b"))).toBe(false);
  });

  it("roteador só existe na OpenRouter", () => {
    expect(ehRoteador(m("openai", "openrouter/auto"))).toBe(false);
  });
});

describe("separarModelos", () => {
  it("sem busca: roteadores numa lista, o resto na outra", () => {
    const r = separarModelos(catalogo, "");
    expect(r.roteadores.map((x) => x.model_id)).toEqual([
      "typesafe/jev-router",
      "openrouter/auto",
      "openrouter/fusion",
      "openrouter/pareto-code",
    ]);
    expect(r.modelos).toHaveLength(3);
  });

  it("busca por pedaço do id ou do nome, sem caixa", () => {
    expect(separarModelos(catalogo, "JEV").roteadores.map((x) => x.model_id)).toEqual(["typesafe/jev-router"]);
    expect(separarModelos(catalogo, "haiku").modelos.map((x) => x.model_id)).toEqual(["anthropic/claude-haiku-5.5"]);
  });

  it("o modelo já escolhido fica na lista mesmo fora da busca", () => {
    const r = separarModelos(catalogo, "jev", "anthropic/claude-haiku-5.5");
    expect(r.modelos.map((x) => x.model_id)).toEqual(["anthropic/claude-haiku-5.5"]);
    expect(r.roteadores.map((x) => x.model_id)).toEqual(["typesafe/jev-router"]);
  });
});
