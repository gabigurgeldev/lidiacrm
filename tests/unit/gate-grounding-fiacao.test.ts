/**
 * Conferência de fundamentação — a cadeia REAL e a FIAÇÃO.
 *
 * `grounding.test.ts` prova a DECISÃO. Isto prova o CAMINHO: o contexto atravessa
 * `RunBeforeSendArgs` → `GateContext` → gate → veto → trace, e só o `send_message`
 * do agente o arma. Mesmo molde de `gate-vazamento-interno.test.ts`, pelo mesmo
 * motivo: um campo que morresse no meio deixaria a decisão verde e o gate
 * desligado em produção.
 *
 * A fiação é conferida na FONTE (não há seam leve para `runAgentTurn`) — é guarda
 * de ligação, não prova de execução ponta a ponta, e isso está dito.
 */
import fs from "node:fs";
import path from "node:path";

import type pg from "pg";
import { describe, expect, it, vi } from "vitest";

import { runBeforeSend } from "@/lib/agent-engine/guardrails/before-send";
import type { ContextoDeFundamentacao } from "@/lib/agent-engine/guardrails/grounding";
import type { Logger } from "@/lib/agent-engine/obs/logger";

const COMERCIAL = new Date("2026-07-28T13:00:00Z"); // 10h BRT, terça

const SEM_FONTE: ContextoDeFundamentacao = {
  modo: "equipe",
  buscaDisponivel: true,
  buscasFeitas: 1,
  buscasComFonte: 0,
  fontes: "Você é a assistente da Loja Bela.",
  fontesDeNumeros: "Você é a assistente da Loja Bela.",
};

function cadeia(body: string, grounding?: ContextoDeFundamentacao) {
  const client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
  const inserts = vi.fn().mockResolvedValue({ rows: [{ id: "trace-1" }] });
  const pool = { connect: vi.fn().mockResolvedValue(client), query: inserts } as unknown as pg.Pool;
  const log: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return {
    inserts,
    run: runBeforeSend({
      pool,
      log,
      tenantId: "00000000-0000-4000-8000-000000000001",
      leadId: "00000000-0000-4000-8000-000000000002",
      jobId: "00000000-0000-4000-8000-000000000003",
      channelSessionId: "00000000-0000-4000-8000-000000000004",
      body,
      optedOutThisTurn: false,
      crmDailyLimit: null,
      now: COMERCIAL,
      rng: () => 0,
      sleep: async () => {},
      ...(grounding !== undefined ? { grounding } : {}),
      send: async () => ({ kind: "sent", idempotencyKey: "k", messageId: "m" }),
    }),
  };
}

const INVENTADA = "Temos sim o vestido na cor vinho, sai por R$ 189,90.";

describe("a cadeia REAL veta a afirmação sem fonte — e só quando armada", () => {
  it("armada: veta no gate certo, o trace leva categorias e nunca o texto", async () => {
    const { run, inserts } = cadeia(INVENTADA, SEM_FONTE);
    const r = await run;
    expect(r.status).toBe("vetoed");
    if (r.status !== "vetoed") throw new Error("inalcançável");
    expect(r.gate).toBe("grounding");
    expect(r.code).toBe("grounding_sem_fonte");
    expect(r.message).toContain("request_human_handoff");
    const linha = r.trace.find((t) => t.gate === "grounding");
    expect(linha?.verdict).toBe("veto");
    expect(String(linha?.detail?.categorias)).toContain("preco");
    // PII fora: o trecho suspeito não vai ao trace persistido.
    expect(JSON.stringify(inserts.mock.calls)).not.toContain("vinho");
  });

  it("DESARMADA: o MESMO corpo sai — o campo é o que decide, e ele chega", async () => {
    const r = await cadeia(INVENTADA).run;
    expect(r.status).toBe("sent");
    expect(r.trace).toContainEqual({ gate: "grounding", verdict: "pass" });
  });
});

const ler = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const INBOUND = ler("lib/agent-engine/agent/inbound-turn.ts");

function trecho(ancora: string, fim: string): string {
  const i = INBOUND.indexOf(ancora);
  expect(i, `âncora \`${ancora}\` sumiu`).toBeGreaterThan(-1);
  const j = INBOUND.indexOf(fim, i);
  expect(j, `âncora de fim \`${fim}\` sumiu`).toBeGreaterThan(i);
  return INBOUND.slice(i, j);
}

describe("fiação — armado no agente, desarmado em texto escrito por código", () => {
  it("send_message arma com o contexto do turno", () => {
    const corpo = trecho("send_message: tool({", "update_lead_state: tool({");
    expect(corpo).toMatch(/const fundamentacao = contextoDeFundamentacao\(\)/);
    expect(corpo).toMatch(/grounding: fundamentacao/);
  });

  it.each([
    "lib/agent-engine/agent/followup-turn.ts",
    "lib/agent-engine/agent/aviso-de-escalacao.ts",
    "lib/agent-engine/agent/aviso-sem-fonte.ts",
  ])("%s NÃO arma — texto de código não afirma fato, e veto ali é silêncio", (arquivo) => {
    expect(ler(arquivo)).not.toMatch(/\bgrounding\s*:/);
  });

  it("send_template NÃO arma — o texto é do humano, aprovado pela Meta", () => {
    expect(trecho("send_template: tool({", "search_knowledge: tool({")).not.toMatch(/grounding/);
  });

  it("o fail-safe conta vetos e, ao persistir, o RUNTIME assume — nunca libera a afirmação", () => {
    const corpo = trecho("send_message: tool({", "update_lead_state: tool({");
    expect(corpo).toMatch(/chain\.code === 'grounding_sem_fonte'/);
    expect(corpo).toMatch(/vetosDeFonte \+= 1/);
    expect(corpo).toMatch(/vetosDeFonte >= MAX_VETOS_DE_FONTE/);
    // Ao contrário do gate de vocabulário, não há re-run desarmando este gate.
    expect(corpo).not.toMatch(/grounding: undefined/);
  });

  it("o fallback roda ANTES do resgate de turno mudo", () => {
    const fallback = INBOUND.indexOf("decidirFallbackSemFonte({");
    const resgate = INBOUND.indexOf("decidirResgateDoTurnoMudo({");
    expect(fallback).toBeGreaterThan(-1);
    expect(resgate).toBeGreaterThan(fallback);
  });

  it("a conferência respeita o interruptor da organização", () => {
    expect(INBOUND).toMatch(/if \(!ajustesDeFonte\.conferenciaLigada\) return undefined;/);
  });
});
