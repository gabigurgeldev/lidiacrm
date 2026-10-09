/**
 * Execuções do agente: o motor grava UMA linha por turno, com o desfecho.
 *
 * A aba Execuções lia `ai_agent_runs` e o motor vivo nunca escrevia ali — ela
 * ficava vazia com o agente atendendo. Aqui: a regra do desfecho, o trace das
 * ferramentas, e a gravação que nunca derruba o turno.
 *
 * Sabotagens medidas:
 *  - `statusDoTurno` sem o ramo `adiado` ⇒ "adiado é aborted" vermelho;
 *  - `gravarRegistroDoTurno` sem o `if (registro.agente === null) return` ⇒
 *    "sem agente não grava" vermelho;
 *  - tirar o `try/catch` de `gravarRegistroDoTurno` ⇒ "falha do banco" vermelho;
 *  - `ferramentasDosPassos` casando resultado só pelo nome ⇒ "mesma ferramenta
 *    duas vezes" vermelho.
 */
import { describe, expect, it, vi } from "vitest";

import {
  ferramentasDosPassos,
  gravarRegistroDoTurno,
  novoRegistroDoTurno,
  statusDoTurno,
} from "@/lib/agent-engine/agent/registro-do-turno";
import { lerExecucao } from "@/lib/ai/agents/leitura-da-execucao";

const base = { erro: false, adiado: false, enviadas: 0, passouParaHumano: false, motivo: null };

describe("statusDoTurno", () => {
  it("mensagem saiu: completed", () => {
    expect(statusDoTurno({ ...base, enviadas: 2 })).toEqual({ status: "completed", abortReason: null });
  });

  it("limite cortou mas o cliente foi respondido: completed com o motivo", () => {
    expect(statusDoTurno({ ...base, enviadas: 1, motivo: "limite_do_turno" })).toEqual({
      status: "completed",
      abortReason: "limite_do_turno",
    });
  });

  it("adiado é aborted, com o motivo do adiamento (ou 'adiado')", () => {
    expect(statusDoTurno({ ...base, adiado: true, motivo: "fora_do_horario" })).toEqual({
      status: "aborted",
      abortReason: "fora_do_horario",
    });
    expect(statusDoTurno({ ...base, adiado: true })).toEqual({ status: "aborted", abortReason: "adiado" });
  });

  it("erro é failed", () => {
    expect(statusDoTurno({ ...base, erro: true }).status).toBe("failed");
  });

  it("sem mensagem: passou para humano é handoff; senão ficou sem resposta", () => {
    expect(statusDoTurno({ ...base, passouParaHumano: true }).status).toBe("handoff");
    expect(statusDoTurno(base)).toEqual({ status: "aborted", abortReason: "sem_resposta" });
  });
});

describe("ferramentasDosPassos", () => {
  it("liga cada chamada ao seu resultado pelo id, numerando o passo", () => {
    const passos = [
      {
        toolCalls: [
          { toolCallId: "a", toolName: "search_knowledge", input: { q: "preço" } },
          { toolCallId: "b", toolName: "search_knowledge", input: { q: "prazo" } },
        ],
        toolResults: [
          { toolCallId: "b", toolName: "search_knowledge", output: "2 dias" },
          { toolCallId: "a", toolName: "search_knowledge", output: "R$ 10" },
        ],
      },
      { toolCalls: [{ toolCallId: "c", toolName: "send_message", input: { body: "oi" } }], toolResults: [] },
    ];
    expect(ferramentasDosPassos(passos)).toEqual([
      { step: 1, tool_name: "search_knowledge", args: { q: "preço" }, result: "R$ 10" },
      { step: 1, tool_name: "search_knowledge", args: { q: "prazo" }, result: "2 dias" },
      { step: 2, tool_name: "send_message", args: { body: "oi" }, result: null },
    ]);
  });

  it("apara saída grande", () => {
    const [p] = ferramentasDosPassos([
      { toolCalls: [{ toolCallId: "x", toolName: "t", input: "a".repeat(5000) }], toolResults: [] },
    ]);
    expect(String(p!.args).length).toBeLessThan(2100);
    expect(String(p!.args)).toMatch(/aparado/);
  });
});

function poolFalso(falhar = false) {
  const consultas: Array<{ sql: string; params: unknown[] }> = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    consultas.push({ sql, params });
    if (falhar) throw new Error("conexão caiu");
    if (/from llm_calls/.test(sql)) return { rows: [{ tokens_in: "120", tokens_out: "30", cost_cents: "0.4500" }] };
    if (/from messages/.test(sql)) return { rows: [{ id: "msg-saida" }] };
    return { rows: [] };
  });
  return { pool: { query } as never, consultas };
}

const ctx = {
  tenantId: "org",
  jobId: "job",
  leadId: "lead",
  conversationId: "conv",
  channelSessionId: "sess",
  inboundMessageId: "msg-entrada",
};
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;

describe("gravarRegistroDoTurno", () => {
  it("sem agente publicado (agente genérico) não grava nada", async () => {
    const { pool, consultas } = poolFalso();
    await gravarRegistroDoTurno(pool, ctx, novoRegistroDoTurno(), { erro: null, adiado: false, passouParaHumano: async () => false }, log);
    expect(consultas).toHaveLength(0);
  });

  it("grava uma linha com tokens e custo de llm_calls do job e a última mensagem que saiu", async () => {
    const { pool, consultas } = poolFalso();
    const registro = { ...novoRegistroDoTurno(new Date(Date.now() - 1500)), agente: { agentId: "ag", versionId: "v" }, passos: 3, enviadas: 1 };
    await gravarRegistroDoTurno(pool, ctx, registro, { erro: null, adiado: false, passouParaHumano: async () => false }, log);
    const insert = consultas.find((c) => /insert into ai_agent_runs/.test(c.sql))!;
    expect(insert).toBeDefined();
    const [org, agente, versao, conversa, contato, sessao, entrada, saida, status, motivo] = insert.params;
    expect([org, agente, versao, conversa, contato, sessao, entrada, saida, status, motivo]).toEqual([
      "org", "ag", "v", "conv", "lead", "sess", "msg-entrada", "msg-saida", "completed", null,
    ]);
    expect(insert.params.slice(12, 15)).toEqual([120, 30, 0.45]);
    expect(insert.params[16]).toBe(3);
    expect(insert.params[15]).toBeGreaterThanOrEqual(1500);
  });

  it("falha do banco não derruba o turno", async () => {
    const { pool } = poolFalso(true);
    const registro = { ...novoRegistroDoTurno(), agente: { agentId: "ag", versionId: "v" } };
    await expect(
      gravarRegistroDoTurno(pool, ctx, registro, { erro: null, adiado: false, passouParaHumano: async () => false }, log),
    ).resolves.toBeUndefined();
  });
});

describe("lerExecucao", () => {
  it("diz o desfecho em português, com o motivo", () => {
    expect(lerExecucao("completed", null)).toEqual({ rotulo: "Respondeu", tom: "ok" });
    expect(lerExecucao("aborted", "fora_do_horario").rotulo).toBe("Adiado: fora do horário");
    expect(lerExecucao("aborted", "sem_resposta")).toEqual({ rotulo: "Ficou sem resposta", tom: "erro" });
    expect(lerExecucao("handoff", null).rotulo).toBe("Passou para uma pessoa");
    expect(lerExecucao("completed", "limite_do_turno").tom).toBe("atencao");
  });
});
