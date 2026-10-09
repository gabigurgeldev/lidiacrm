/**
 * No ensaio, o agente vê AS MESMAS capacidades da produção — e nenhuma executa.
 *
 * As duas metades importam e falham de jeitos diferentes:
 *
 *  - vitrine diferente da produção: o teste diria como decide um agente que não
 *    é o que atende (uma capacidade a mais, e ele "resolve" no teste o que no
 *    atendimento passaria para a equipe);
 *  - capacidade executando: o handler fala com o banco pelo cliente HTTP do
 *    Supabase, por FORA da transação desfeita do ensaio — testar moveria o card
 *    e marcaria a consulta de verdade, que era o defeito do botão Testar antigo.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { BLOCKED_TOOL_IDS } from "@/lib/agent-engine/edge/crm/mcp-tools";
import { capacidadesSimuladas } from "@/lib/agent-engine/ensaio/capacidades-simuladas";
import { pickToolsFromMcp } from "@/lib/ai/runtime/tools";
import type { McpAuthResult } from "@/lib/mcp/auth";
import { allTools } from "@/lib/mcp/tools";
import type { McpContext } from "@/lib/mcp/types";

const ORG = "11111111-1111-4111-8111-111111111111";
const TODOS = allTools.map((t) => t.name);

function daProducao(ids: readonly string[]) {
  const ctx = {
    organizationId: ORG,
    role: "ai_operator",
    actor: { type: "ai_agent", id: "agente-1", role: "ai_operator" },
    apiTokenId: "tok-1",
    requestId: "run-1",
    supabase: {} as never,
  } as unknown as McpContext;
  const auth = {
    organizationId: ORG,
    role: "ai_operator",
    actor: ctx.actor,
    apiTokenId: "tok-1",
    scopes: ["mcp:read", "mcp:write", "actor:ai_agent"],
  } as unknown as McpAuthResult;
  // O mesmo recorte de `buildMcpTurnTools`: bloqueadas saem antes da ponte.
  return pickToolsFromMcp({
    supabase: ctx.supabase,
    ctx,
    auth,
    toolIds: ids.filter((id) => !BLOCKED_TOOL_IDS.has(id)),
    handoffToolEnabled: false,
    handoffSignal: { triggered: false },
    pipelineIds: [],
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ensaio: capacidades simuladas", () => {
  it("o catálogo não está vazio (guarda de vacuidade)", () => {
    expect(TODOS.length).toBeGreaterThan(10);
  });

  it("mostra ao modelo exatamente as capacidades que a produção montaria", () => {
    const producao = daProducao(TODOS);
    const ensaio = capacidadesSimuladas(TODOS);

    expect(Object.keys(ensaio).sort()).toEqual(Object.keys(producao).sort());
    for (const nome of Object.keys(producao)) {
      expect(ensaio[nome]?.description, nome).toBe(producao[nome]?.description);
    }
  });

  it("as bloqueadas do turno (envio, passagem) e as de pessoa ficam de fora", () => {
    const ensaio = capacidadesSimuladas(TODOS);
    for (const id of BLOCKED_TOOL_IDS) expect(ensaio[id], id).toBeUndefined();
  });

  it("nenhuma capacidade executa o handler — leitura inclusive", async () => {
    const espioes = allTools.map((def) => vi.spyOn(def, "handler"));
    const ensaio = capacidadesSimuladas(TODOS);
    const nomes = Object.keys(ensaio);
    expect(nomes.length).toBeGreaterThan(0);

    for (const nome of nomes) {
      const resultado = await ensaio[nome]!.execute!({}, { toolCallId: "t", messages: [] } as never);
      expect(resultado, nome).toMatchObject({ ok: true, simulado: true, ferramenta: nome });
    }
    for (const espiao of espioes) expect(espiao).not.toHaveBeenCalled();
  });
});
