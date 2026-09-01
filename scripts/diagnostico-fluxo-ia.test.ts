/**
 * A SONDA PRECISA IMITAR A PRODUÇÃO — E NUNCA IMPRIMIR A CHAVE.
 *
 * Duas cercas, e as duas nasceram de riscos concretos desta sonda:
 *
 *   1. Sonda que diverge do caminho real responde sobre um pedido que ninguém
 *      faz. Se o `@ai-sdk/openai` mudar a forma do `response_format` e a sonda
 *      continuar montando a forma antiga, ela vai dizer "funciona" sobre um
 *      corpo que a produção não envia — e a próxima investigação começa de uma
 *      medição falsa, que é pior do que começar sem medição.
 *   2. O corpo de erro da OpenRouter pode ecoar o cabeçalho `Authorization`. A
 *      saída desta sonda vai para o terminal de quem pediu ajuda e, com
 *      frequência, para um print colado numa issue pública.
 */
import { describe, expect, it } from "vitest";

import { corpoDaChamada, contarUnioes, caminhosRecusados, lerOpcoes, mascarar } from "./diagnostico-fluxo-ia";

describe("sonda de fluxo com IA", () => {
  it("monta o corpo como o @ai-sdk/openai monta", () => {
    const corpo = corpoDaChamada({
      modelo: "anthropic/claude-sonnet-5",
      schema: { type: "object" },
      system: "s",
      prompt: "p",
      maxOutputTokens: 4000,
      requireParameters: false,
    }) as {
      response_format: { type: string; json_schema: { strict: boolean; name: string } };
      max_tokens: number;
      provider?: unknown;
    };

    // A forma exata que `node_modules/@ai-sdk/openai/dist/index.js` emite. Se
    // uma destas três mudar lá e não mudar aqui, a sonda deixou de medir a
    // produção — e é isto que este caso reprova.
    expect(corpo.response_format.type).toBe("json_schema");
    expect(corpo.response_format.json_schema.strict).toBe(false);
    expect(corpo.response_format.json_schema.name).toBe("response");
    expect(corpo.max_tokens).toBe(4000);
    expect(corpo.provider).toBeUndefined();
  });

  it("só envia require_parameters quando pedido", () => {
    const corpo = corpoDaChamada({
      modelo: "m",
      schema: {},
      system: "s",
      prompt: "p",
      maxOutputTokens: 10,
      requireParameters: true,
    }) as { provider?: { require_parameters?: boolean } };
    expect(corpo.provider?.require_parameters).toBe(true);
  });

  it("mascara a chave em qualquer posição da saída", () => {
    const chave = "sk-or-v1-abcdef0123456789";
    const eco = `erro: {"headers":{"authorization":"Bearer ${chave}"},"key":"${chave}"}`;
    const saida = mascarar(eco, [chave]);
    expect(saida).not.toContain(chave);
    expect(saida).toContain("***");
  });

  it("conta uniões em qualquer profundidade", () => {
    const schema = {
      type: "object",
      properties: { a: { anyOf: [{ type: "string" }] }, b: { items: { oneOf: [] } } },
    };
    expect(contarUnioes(schema)).toEqual({ anyOf: 1, oneOf: 1 });
  });

  it("extrai os caminhos que o Zod recusou, inclusive aninhados em cause", () => {
    const erro = { cause: { issues: [{ path: ["nodes", 17, "config", "mensagem"] }] } };
    expect(caminhosRecusados(erro)).toEqual(["nodes.17.config.mensagem"]);
  });

  it("lê as opções da linha de comando", () => {
    const o = lerOpcoes(["--etapa=antigo", "--modo=cru", "--require-parameters", "--bytes=10"]);
    expect(o.modo).toBe("cru");
    expect(o.requireParameters).toBe(true);
    expect(o.bytes).toBe(10);
  });
});
