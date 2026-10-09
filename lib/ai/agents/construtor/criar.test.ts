import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type * as Validacao from "@/lib/ai/agents/validation";

import { audit } from "@/lib/audit";
import { listSelectableChannels } from "@/lib/channels/selectable";
import { resolverProvedorDoAgente } from "@/lib/ai/agents/provedor-do-agente";
import { criarMaterialDeTexto } from "@/lib/ai/rag/criar-material";

import { criarAgenteDaPrevia } from "./criar";
import type { Previa } from "./esquemas";

/**
 * A única escrita do construtor.
 *
 * O que se prova:
 *  - a organização é a do CONTEXTO (sessão) em toda linha gravada;
 *  - canal de outra organização é recusado ANTES de qualquer escrita;
 *  - capacidades além do teto são recusadas antes de qualquer escrita;
 *  - o agente nasce em RASCUNHO, nunca publicado, com os materiais no acervo;
 *  - material que falha não derruba o agente — e a resposta diz qual falhou;
 *  - sem chave de IA o rascunho nasce, com aviso; sem modelo, nada nasce.
 */

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/channels/selectable", () => ({ listSelectableChannels: vi.fn() }));
vi.mock("@/lib/ai/agents/provedor-do-agente", () => ({ resolverProvedorDoAgente: vi.fn() }));
vi.mock("@/lib/ai/rag/criar-material", () => ({ criarMaterialDeTexto: vi.fn() }));
vi.mock("@/lib/ai/embeddings/chave", () => ({ temChaveDeEmbedding: vi.fn(async () => true) }));
vi.mock("@/lib/ai/agents/capacidades-padrao", () => {
  const mapa: Record<string, string[]> = {
    atender: ["read_conversation", "search_knowledge"],
    vender: ["crm_create_lead"],
    reter: [],
    escalar: ["handoff"],
    organizar: Array.from({ length: 30 }, (_, i) => `org_${i}`),
    evoluir: [],
  };
  const catalogo = Object.values(mapa)
    .flat()
    .map((name) => ({ name, risco: "seguro", pacotes: Object.keys(mapa).filter((k) => mapa[k]?.includes(name)) }));
  return { catalogoComHandler: () => catalogo, capacidadesPorPacote: () => mapa };
});
vi.mock("@/lib/ai/agents/validation", async (orig) => {
  // O schema real, mas sem a lista fechada de ids de ferramenta: o catálogo
  // deste teste é inventado.
  const real = await orig<typeof Validacao>();
  return { ...real, versionCreateSchema: real.versionCreateSchema.extend({ tool_ids: z.array(z.string()) }) };
});

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const CANAL = "33333333-3333-4333-8333-333333333333";
const CANAL_DE_OUTRA_ORG = "44444444-4444-4444-8444-444444444444";
const FUNIL = "55555555-5555-4555-8555-555555555555";
const MAT = "66666666-6666-4666-8666-666666666666";

const inserts: Array<{ tabela: string; linha: Record<string, unknown> }> = [];
let falharVersao = false;

function adminFalso() {
  return {
    from(tabela: string) {
      const b: Record<string, unknown> = {};
      const self = () => b;
      b.select = self;
      b.eq = self;
      b.update = (linha: Record<string, unknown>) => {
        inserts.push({ tabela: `${tabela}:update`, linha });
        return b;
      };
      b.maybeSingle = async () => (tabela === "crm_pipelines" ? { data: { id: FUNIL }, error: null } : { data: null, error: null });
      b.insert = (linha: Record<string, unknown>) => {
        inserts.push({ tabela, linha });
        const resultado =
          tabela === "ai_agent_versions" && falharVersao
            ? { data: null, error: { message: "boom" } }
            : { data: { id: tabela === "ai_agents" ? "agent-1" : "version-1" }, error: null };
        return { select: () => ({ single: async () => resultado }), then: (r: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(r) };
      };
      b.then = (r: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(r);
      return b;
    },
  };
}

function previa(over: Partial<Previa> = {}): Previa {
  return {
    nome: "Bia",
    descricao: "Atende a clínica",
    system_prompt: "Quem você é: a Bia, assistente virtual da Clínica Sorriso.",
    pacotes: ["atender", "escalar"],
    handoff_keywords: ["atendente"],
    materiais: [{ tipo: "faq", nome: "Perguntas frequentes", itens: [{ pergunta: "Abre sábado?", resposta: "Sim, das 8h às 12h." }] }],
    channel_session_id: CANAL,
    ...over,
  };
}

const ctx = { organizationId: ORG, userId: USER, requestId: "req-1" };

beforeEach(() => {
  inserts.length = 0;
  falharVersao = false;
  vi.mocked(audit).mockClear();
  vi.mocked(criarMaterialDeTexto).mockReset();
  vi.mocked(criarMaterialDeTexto).mockResolvedValue({ ok: true, id: MAT, nome: "Perguntas frequentes", itemsCount: 1 });
  vi.mocked(listSelectableChannels).mockResolvedValue([
    { id: CANAL, display_name: "Recepção", status: "connected", phone_number: null },
  ]);
  vi.mocked(resolverProvedorDoAgente).mockResolvedValue({
    ok: true,
    provider: "anthropic",
    modelId: "claude-haiku-4-5",
    credentialId: null,
  });
});

describe("criarAgenteDaPrevia", () => {
  it("cria materiais e o agente em RASCUNHO, tudo na organização da sessão", async () => {
    const r = await criarAgenteDaPrevia(adminFalso() as never, ctx, previa());
    expect(r).toMatchObject({ ok: true, agent_id: "agent-1", version_id: "version-1", materiais: [{ id: MAT }] });

    expect(criarMaterialDeTexto).toHaveBeenCalledWith(expect.anything(), ORG, expect.objectContaining({ renomearSeEmUso: true }));
    const versao = inserts.find((i) => i.tabela === "ai_agent_versions")?.linha;
    expect(versao).toMatchObject({
      organization_id: ORG,
      agent_id: "agent-1",
      version_number: 1,
      status: "draft",
      knowledge_source_ids: [MAT],
      pipeline_ids: [FUNIL],
      channel_session_id: CANAL,
      provider: "anthropic",
      model: "claude-haiku-4-5",
      tool_ids: ["read_conversation", "search_knowledge", "handoff"],
    });
    expect(versao).not.toHaveProperty("published_at");
    expect(inserts.find((i) => i.tabela === "ai_agents")?.linha).toMatchObject({
      organization_id: ORG,
      kind: "mcp_agent",
      is_default: false,
    });
    expect(inserts.every((i) => i.linha.organization_id === undefined || i.linha.organization_id === ORG)).toBe(true);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ai_agent.created", organizationId: ORG, metadata: expect.objectContaining({ origem: "construtor" }) }),
    );
  });

  it("canal que não é desta organização: recusa ANTES de escrever", async () => {
    const r = await criarAgenteDaPrevia(adminFalso() as never, ctx, previa({ channel_session_id: CANAL_DE_OUTRA_ORG }));
    expect(r).toMatchObject({ ok: false, status: 422 });
    expect(criarMaterialDeTexto).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it("capacidades além do teto: recusa ANTES de escrever", async () => {
    const r = await criarAgenteDaPrevia(adminFalso() as never, ctx, previa({ pacotes: ["organizar", "atender"] }));
    expect(r).toMatchObject({ ok: false, status: 422 });
    expect(inserts).toHaveLength(0);
  });

  it("sem modelo no provedor: nada nasce", async () => {
    vi.mocked(resolverProvedorDoAgente).mockResolvedValue({
      ok: false,
      reason: "no_model",
      provider: "openrouter",
      motivo: "catalogo_vazio",
    });
    const r = await criarAgenteDaPrevia(adminFalso() as never, ctx, previa());
    expect(r).toMatchObject({ ok: false, code: "ai_provider_error" });
    expect(inserts).toHaveLength(0);
  });

  it("sem chave: o rascunho nasce, e a resposta avisa", async () => {
    vi.mocked(resolverProvedorDoAgente).mockResolvedValue({
      ok: false,
      reason: "sem_chave",
      provider: "anthropic",
      modelId: "claude-haiku-4-5",
    });
    const r = await criarAgenteDaPrevia(adminFalso() as never, ctx, previa());
    expect(r.ok).toBe(true);
    expect(r.ok && r.avisos.length).toBe(1);
  });

  it("material que falha não derruba o agente — e a resposta diz qual", async () => {
    vi.mocked(criarMaterialDeTexto).mockResolvedValue({ ok: false, motivo: "falha", mensagem: "Erro ao criar o material." });
    const r = await criarAgenteDaPrevia(adminFalso() as never, ctx, previa());
    expect(r).toMatchObject({
      ok: true,
      materiais: [],
      materiais_com_falha: [{ nome: "Perguntas frequentes", motivo: "Erro ao criar o material." }],
    });
  });

  it("versão falha: o agente é arquivado e os materiais criados são informados", async () => {
    falharVersao = true;
    const r = await criarAgenteDaPrevia(adminFalso() as never, ctx, previa());
    expect(r).toMatchObject({ ok: false, status: 500, materiais_criados: [{ id: MAT }] });
    expect(inserts.some((i) => i.tabela === "ai_agents:update" && "archived_at" in i.linha)).toBe(true);
  });
});
