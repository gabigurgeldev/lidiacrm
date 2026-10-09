/**
 * Os limites por atendimento da tela do agente passam a valer
 * (`lib/agent-engine/agent/orcamento-do-turno.ts`).
 *
 * "Limite de tokens por atendimento" e "Limite de custo por atendimento" eram
 * salvos e nunca lidos: um agente em laço de ferramenta gastava até o teto de
 * passos. Aqui se prova a regra (o que conta, quando estoura) e o corte no seam
 * (`runModelCall` para o laço no passo em que o limite é alcançado), além do
 * `llm_calls.agent_id` — sem ele não há custo por agente na tela.
 *
 * Sabotagens medidas: tirar o `pararQuando` do `stopWhen` (o laço vai até o teto
 * de passos); contar o cache relido como token novo; gravar `agent_id` nulo.
 */
import { tool } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { textoDoAvisoDoLimite } from "@/lib/agent-engine/agent/aviso-do-limite-do-turno";
import {
  decidirAposOLimite,
  estouroDoTurno,
  GASTO_ZERO,
  somarGasto,
} from "@/lib/agent-engine/agent/orcamento-do-turno";
import { createFakeRegistry } from "@/lib/agent-engine/edge/llm/providers";
import { runModelCall } from "@/lib/agent-engine/edge/llm/run-model-call";

const ORG = "22222222-2222-4222-8222-222222222222";
const AGENTE = "33333333-3333-4333-8333-333333333333";

describe("a regra do limite", () => {
  const limites = { tokens: 1000, centavos: 10 };

  it("estoura por tokens antes do custo, e só ao alcançar", () => {
    expect(estouroDoTurno({ tokens: 999, centavos: 9.9, semPreco: false }, limites)).toBeNull();
    expect(estouroDoTurno({ tokens: 1000, centavos: 0, semPreco: false }, limites)).toBe("tokens");
    expect(estouroDoTurno({ tokens: 10, centavos: 10, semPreco: false }, limites)).toBe("custo");
  });

  it("conta tokens NOVOS: o prefixo relido do cache não gasta o limite", () => {
    const passo = { usage: { inputTokens: 900, outputTokens: 50, inputTokenDetails: { cacheReadTokens: 800 } } };
    const g = somarGasto(GASTO_ZERO, [passo, passo], () => 1);
    expect(g.tokens).toBe(2 * (100 + 50));
    expect(g.centavos).toBe(2);
  });

  it("modelo sem preço marca o gasto como piso", () => {
    const g = somarGasto(GASTO_ZERO, [{ usage: { inputTokens: 10, outputTokens: 1 } }], () => null);
    expect(g).toEqual({ tokens: 11, centavos: 0, semPreco: true });
  });

  it("depois do corte: respondeu fecha, não respondeu força a resposta", () => {
    expect(decidirAposOLimite({ estouro: null, jaRespondeu: false })).toBe("seguir");
    expect(decidirAposOLimite({ estouro: "tokens", jaRespondeu: true })).toBe("fechar");
    expect(decidirAposOLimite({ estouro: "custo", jaRespondeu: false })).toBe("forcar_resposta");
  });
});

function poolQueGrava() {
  const inserts: Array<{ sql: string; params: unknown[] }> = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("settings->'llm'")) {
      return {
        rows: [
          {
            llm: {
              provider: "anthropic",
              default_model: "claude-padrao",
              params: {},
              enabled_models: [],
              monthly_budget_cents: null,
            },
          },
        ],
      };
    }
    if (sql.includes("insert into llm_calls")) {
      inserts.push({ sql, params });
      return { rows: [{ id: "call-1" }] };
    }
    return { rows: [] };
  });
  return { pool: { query } as never, inserts };
}

/** Modelo em laço: chama a ferramenta para sempre, 600 tokens novos por passo. */
function modeloEmLaco() {
  const estado = { passos: 0 };
  const doGenerate = async () => {
    estado.passos += 1;
    return {
      content: [
        { type: "tool-call" as const, toolCallId: `c${estado.passos}`, toolName: "consultar", input: "{}" },
      ],
      finishReason: { unified: "tool-calls" as const, raw: undefined },
      usage: {
        inputTokens: { total: 600, noCache: 600, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 10, text: 10, reasoning: 0 },
      },
      warnings: [],
    };
  };
  return { doGenerate, estado };
}

const consultar = tool({
  description: "consulta",
  inputSchema: z.object({}),
  execute: async () => ({ ok: true }),
});

function chamar(opts: { comLimite: boolean }) {
  const { pool, inserts } = poolQueGrava();
  const { doGenerate, estado } = modeloEmLaco();
  const limites = { tokens: 1000, centavos: 10_000 };
  const p = runModelCall(
    pool,
    { anthropicApiKey: "k-teste", cacheTtl: "1h" as const },
    {
      tenantId: ORG,
      purpose: "agent_turn",
      messages: [{ role: "user", content: "oi" }],
      tools: { consultar },
      maxSteps: 12,
      agentId: AGENTE,
      ...(opts.comLimite
        ? {
            pararQuando: (passos, custo) => estouroDoTurno(somarGasto(GASTO_ZERO, passos, custo), limites) !== null,
          }
        : {}),
    },
    { registry: createFakeRegistry(doGenerate as never) },
  );
  return { p, estado, inserts };
}

describe("o corte no seam", () => {
  it("o laço para no passo em que o limite é alcançado", async () => {
    const { p, estado } = chamar({ comLimite: true });
    await p;
    // 610 tokens no 1º passo, 1220 no 2º: para no 2º.
    expect(estado.passos).toBe(2);
  });

  it("sem limite, o mesmo modelo vai até o teto de passos (o que acontecia antes)", async () => {
    const { p, estado } = chamar({ comLimite: false });
    await p;
    expect(estado.passos).toBe(12);
  });

  it("a chamada grava o agente em llm_calls — é o que dá custo por agente", async () => {
    const { p, inserts } = chamar({ comLimite: true });
    await p;
    const linha = inserts.find((i) => i.sql.includes("insert into llm_calls"));
    expect(linha?.sql).toContain("agent_id");
    expect(linha?.params.at(-1)).toBe(AGENTE);
  });
});

describe("o aviso na Central", () => {
  const base = { nomeDoAgente: "Recepção", limites: { tokens: 1000, centavos: 50 } };

  it("diz qual limite cortou, com os números, e onde mexer", () => {
    const t = textoDoAvisoDoLimite({
      ...base,
      estouro: "tokens",
      gasto: { tokens: 1220, centavos: 3, semPreco: false },
      jaRespondeu: false,
    });
    expect(t.title).toBe("O limite por atendimento cortou o agente Recepção");
    expect(t.body).toContain("1.220 tokens, para um limite de 1.000");
    expect(t.body).toContain("foi obrigado a responder ou passar a conversa para a equipe");
    expect(t.body).toContain("suba os limites");
  });

  it("corte por custo, já tendo respondido", () => {
    const t = textoDoAvisoDoLimite({
      ...base,
      estouro: "custo",
      gasto: { tokens: 10, centavos: 52, semPreco: false },
      jaRespondeu: true,
    });
    expect(t.body).toContain("US$ 0,52, para um limite de US$ 0,50");
    expect(t.body).toContain("O cliente foi respondido");
  });
});
