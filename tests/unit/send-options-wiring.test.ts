import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { AGENT_TOOL_DEFS } from "@/lib/agent-engine/agent/inbound-turn";
import { frameOpcoes } from "@/lib/agent-engine/edge/crm/get-lead-context";

/**
 * A LIGAÇÃO do `send_options` no turno do agente — mesmo tipo de guard de
 * `send-template-wiring.test.ts`, e pela mesma razão: as peças (decisão de
 * formato, payload do canal, handler) têm testes próprios; o que nenhum deles
 * toca é o que o `execute` passa à cadeia de guardrails e ao canal.
 *
 * Prova que as decisões abaixo estão escritas no código que roda e que
 * removê-las produz vermelho. NÃO prova o turno inteiro com um modelo
 * escolhendo a tool — isso é do harness de `tests/invariants/`.
 */

const FONTE = fs.readFileSync(path.join(process.cwd(), "lib/agent-engine/agent/inbound-turn.ts"), "utf8");

function corpoDoExecute(): string {
  const i = FONTE.indexOf("send_options: tool({");
  expect(i, "âncora `send_options: tool({` sumiu do turno").toBeGreaterThan(-1);
  const j = FONTE.indexOf("search_knowledge: tool({", i);
  expect(j, "âncora de fim (a tool seguinte) sumiu").toBeGreaterThan(i);
  return FONTE.slice(i, j);
}

describe("send_options — a tool obedece ao interruptor do agente", () => {
  it("some do objeto de tools quando o agente não a liga", () => {
    const gate = FONTE.slice(FONTE.indexOf("delete rawTools.send_options") - 200);
    expect(gate.slice(0, 200)).toMatch(/interactiveOptionsEnabled !== true/);
    expect(FONTE).toMatch(/delete rawTools\.send_options;/);
  });
});

describe("send_options — o execute não pode virar rota de fuga dos guardrails", () => {
  it("a pergunta NUMERADA passa pela cadeia before_send como corpo", () => {
    const corpo = corpoDoExecute();
    expect(corpo).toMatch(/const corpo = textoDasOpcoes\(/);
    expect(corpo).toMatch(/runBeforeSend\(\{[\s\S]*body: corpo,/);
  });

  it("a rede de vocabulário interno vale: o texto é do modelo", () => {
    expect(corpoDoExecute()).toMatch(/enforceInternalVocabulary: true/);
  });

  it("respeita a cerca do coordenador", () => {
    expect(corpoDoExecute()).toMatch(/coordenacao: concessaoDoEnvio/);
  });

  it("o veto da cadeia devolve erro ao modelo em vez de enviar", () => {
    expect(corpoDoExecute()).toMatch(/chain\.status === 'vetoed'[\s\S]*return \{ ok: false/);
  });

  it("o envio leva as opções ao canal, além do corpo numerado de reserva", () => {
    const corpo = corpoDoExecute();
    expect(corpo).toMatch(/channel\.send\(\{[\s\S]*body: finalBody,[\s\S]*opcoes: \{/);
  });

  it("opções inválidas viram erro de ENSINO, não exceção", () => {
    const corpo = corpoDoExecute();
    expect(corpo).toMatch(/opcoesInterativasSchema\.safeParse/);
    expect(corpo).toMatch(/code: 'opcoes_invalidas'/);
  });
});

describe("send_options — o contrato que o modelo vê", () => {
  const schema = AGENT_TOOL_DEFS.send_options.inputSchema;

  it("aceita a chamada bem-formada, com e sem formato", () => {
    expect(schema.safeParse({ pergunta: "Qual horário?", opcoes: ["9h", "14h"] }).success).toBe(true);
    expect(
      schema.safeParse({ pergunta: "Qual horário?", opcoes: ["9h", "14h"], formato: "lista" }).success,
    ).toBe(true);
  });

  it("recusa uma opção só e formato desconhecido", () => {
    expect(schema.safeParse({ pergunta: "P?", opcoes: ["só uma"] }).success).toBe(false);
    expect(schema.safeParse({ pergunta: "P?", opcoes: ["a", "b"], formato: "botao" }).success).toBe(false);
  });

  it("a descrição diz QUANDO usar e o que fazer depois", () => {
    const d = AGENT_TOOL_DEFS.send_options.description;
    expect(d).toMatch(/2 a 10 escolhas FECHADAS/);
    expect(d).toMatch(/encerre o turno/);
  });
});

describe("o modelo ENXERGA a escolha no histórico", () => {
  it("a resposta tocada vem enquadrada com a pergunta", () => {
    const quadro = frameOpcoes({
      direction: "inbound",
      type: "text",
      body: "Financeiro",
      metadata: {
        resposta_interativa: { formato: "enquete", pergunta: "Qual setor?", opcao_label: "Financeiro" },
      },
    });
    expect(quadro).toBe('[O lead TOCOU numa opção na enquete "Qual setor?". A escolha dele foi:] Financeiro');
  });

  it("a enquete que nós mandamos aparece como enquete", () => {
    expect(
      frameOpcoes({ direction: "outbound", type: "poll", body: "Qual setor?\n\n1️⃣ A\n2️⃣ B", metadata: {} }),
    ).toMatch(/^\[Você mandou uma enquete para o lead tocar:\]\nQual setor\?/);
  });

  it("mensagem comum segue o caminho de sempre", () => {
    expect(frameOpcoes({ direction: "inbound", type: "text", body: "oi", metadata: {} })).toBeNull();
  });
});
