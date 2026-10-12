import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as Validacao from "@/lib/ai/agents/validation";

import { audit } from "@/lib/audit";
import { criarMaterialDeTexto } from "@/lib/ai/rag/criar-material";

import { aplicarCorrecao } from "./aplicar";
import { bancoFalso } from "./banco-falso.test-util";
import { carregarContextoDaCorrecao, conteudoDaLinha } from "./contexto";
import type { Proposta } from "./esquemas";

/**
 * Corrigir agente com IA — as partes que tocam o banco.
 *
 *  - tudo é da organização da SESSÃO: agente, versão, conversa e materiais de
 *    outra organização não são lidos (o banco falso aplica os filtros de
 *    verdade — consulta sem `organization_id` devolveria a linha alheia);
 *  - a conversa vai ao modelo com telefone, e-mail e CPF mascarados;
 *  - aplicar grava RASCUNHO e nunca publica: base rascunho = atualiza o
 *    rascunho; base publicada = nasce v(max+1); base que mudou no meio = 409
 *    sem escrever nada.
 */

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/ai/rag/criar-material", () => ({ criarMaterialDeTexto: vi.fn() }));
vi.mock("@/lib/ai/agents/escopo", () => ({
  validarEscopoDaVersao: vi.fn(async () => ({ ok: true })),
  mensagemDoEscopo: () => "escopo",
}));
vi.mock("@/lib/ai/agents/capacidades-padrao", () => {
  const mapa: Record<string, string[]> = {
    atender: ["read_conversation", "search_knowledge"],
    vender: ["crm_create_lead"],
    reter: [],
    escalar: ["handoff"],
    organizar: Array.from({ length: 30 }, (_, i) => `org_${i}`),
    evoluir: [],
  };
  const catalogo = [...new Set(Object.values(mapa).flat())].map((name) => ({ name }));
  return { catalogoComHandler: () => catalogo, capacidadesPorPacote: () => mapa };
});
vi.mock("@/lib/ai/agents/validation", async (orig) => {
  const { z } = await import("zod");
  const real = await orig<typeof Validacao>();
  // O schema real, sem a lista fechada de ids de ferramenta: o catálogo deste teste é inventado.
  return { ...real, versionCreateSchema: real.versionCreateSchema.extend({ tool_ids: z.array(z.string()) }) };
});

const ORG = "11111111-1111-4111-8111-111111111111";
const OUTRA_ORG = "99999999-9999-4999-8999-999999999999";
const USER = "22222222-2222-4222-8222-222222222222";
const AGENTE = "33333333-3333-4333-8333-333333333333";
const CANAL = "44444444-4444-4444-8444-444444444444";
const V_PUBLICADA = "55555555-5555-4555-8555-555555555555";
const V_RASCUNHO = "66666666-6666-4666-8666-666666666666";
const CONVERSA = "77777777-7777-4777-8777-777777777777";
const CONVERSA_ALHEIA = "88888888-8888-4888-8888-888888888888";
const MATERIAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MATERIAL_NOVO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function versao(over: Record<string, unknown>) {
  return {
    organization_id: ORG,
    agent_id: AGENTE,
    system_prompt: "Quem você é: a Bia, da Clínica Sorriso.\nNunca dê desconto.",
    provider: "anthropic",
    model: "claude-haiku-4-5",
    credential_id: null,
    tool_ids: ["read_conversation", "search_knowledge"],
    channel_session_id: CANAL,
    handoff_keywords: ["atendente"],
    knowledge_source_ids: [MATERIAL],
    pipeline_ids: [],
    operator_model: null,
    ...over,
  };
}

function cenario(opcoes: { comRascunho?: boolean } = {}) {
  return bancoFalso({
    ai_agents: [
      { id: AGENTE, organization_id: ORG, name: "Bia", description: null, kind: "mcp_agent", archived_at: null, published_version_id: V_PUBLICADA },
    ],
    ai_agent_versions: [
      versao({ id: V_PUBLICADA, version_number: 1, status: "published" }),
      ...(opcoes.comRascunho ? [versao({ id: V_RASCUNHO, version_number: 2, status: "draft" })] : []),
      // Mesma numeração, outra organização: não pode aparecer.
      versao({ id: "v-alheia", version_number: 9, status: "draft", organization_id: OUTRA_ORG }),
    ],
    ai_knowledge_sources: [{ id: MATERIAL, organization_id: ORG, name: "Perguntas frequentes", source_type: "faq" }],
    ai_chunks: [{ organization_id: ORG, knowledge_source_id: MATERIAL, position: 0, content: "Abre sábado? Sim." }],
    ai_agent_runs: [
      {
        organization_id: ORG,
        agent_id: AGENTE,
        is_dry_run: false,
        status: "failed",
        abort_reason: null,
        error_code: "tool_error",
        error_message: "boom",
        tool_calls: [{ name: "crm_create_lead" }],
        created_at: "2026-10-12T10:00:00Z",
      },
    ],
    conversations: [
      { id: CONVERSA, organization_id: ORG },
      { id: CONVERSA_ALHEIA, organization_id: OUTRA_ORG },
    ],
    messages: [
      {
        organization_id: ORG,
        conversation_id: CONVERSA,
        body: "Meu telefone é (41) 99999-1234 e meu e-mail joana@exemplo.com",
        direction: "inbound",
        sent_via: "crm",
        type: "text",
        sent_at: "2026-10-12T10:00:00Z",
      },
      {
        organization_id: ORG,
        conversation_id: CONVERSA,
        body: "Claro, te dou 20% de desconto!",
        direction: "outbound",
        sent_via: "ai",
        type: "text",
        sent_at: "2026-10-12T10:01:00Z",
      },
    ],
  });
}

function proposta(over: Partial<Proposta> = {}): Proposta {
  return {
    base_version_id: V_PUBLICADA,
    explicacao: "Reforcei a regra do desconto.",
    system_prompt: "Quem você é: a Bia, da Clínica Sorriso.\nNunca dê desconto. Se pedirem, diga que o preço é fixo e ofereça o parcelamento.",
    mudancas_no_prompt: [{ o_que: "Regra do desconto com alternativa", por_que: "O agente cedia." }],
    materiais_novos: [],
    materiais_desligar: [],
    pacotes_ligar: [],
    pacotes_desligar: [],
    frases_de_passagem_adicionar: [],
    frases_de_passagem_remover: [],
    mensagem_de_teste: "Me dá um desconto?",
    ...over,
  };
}

const ctx = { organizationId: ORG, userId: USER, requestId: "req-1" };
const PROBLEMA = "O agente está dando desconto sem autorização.";

beforeEach(() => {
  vi.mocked(audit).mockClear();
  vi.mocked(criarMaterialDeTexto).mockReset();
  vi.mocked(criarMaterialDeTexto).mockResolvedValue({ ok: true, id: MATERIAL_NOVO, nome: "Formas de pagamento", itemsCount: 1 });
});

describe("carregarContextoDaCorrecao", () => {
  it("lê agente, versão vigente, materiais e execuções da organização da sessão", async () => {
    const { admin } = cenario({ comRascunho: true });
    const r = await carregarContextoDaCorrecao(admin as never, ORG, AGENTE);
    if (!r.ok) throw new Error(r.message);
    expect(r.contexto.base.id).toBe(V_RASCUNHO);
    expect(r.contexto.partiuDoRascunho).toBe(true);
    expect(r.contexto.base.conteudo?.system_prompt).toContain("Clínica Sorriso");
    expect(r.contexto.materiais).toEqual([
      { id: MATERIAL, nome: "Perguntas frequentes", tipo: "faq", amostra: "Abre sábado? Sim." },
    ]);
    expect(r.contexto.execucoes[0]).toMatchObject({ status: "failed", ferramentas: ["crm_create_lead"] });
    expect(r.contexto.conversa).toBeNull();
  });

  it("agente de outra organização: não encontrado", async () => {
    const { admin } = cenario();
    const r = await carregarContextoDaCorrecao(admin as never, OUTRA_ORG, AGENTE);
    expect(r).toMatchObject({ ok: false, status: 404 });
  });

  it("conversa de outra organização: não encontrada, nunca lida", async () => {
    const { admin } = cenario();
    const r = await carregarContextoDaCorrecao(admin as never, ORG, AGENTE, { conversationId: CONVERSA_ALHEIA });
    expect(r).toMatchObject({ ok: false, status: 404 });
  });

  it("a conversa vai mascarada, com quem falou", async () => {
    const { admin } = cenario();
    const r = await carregarContextoDaCorrecao(admin as never, ORG, AGENTE, { conversationId: CONVERSA });
    if (!r.ok) throw new Error(r.message);
    const [cliente, agente] = r.contexto.conversa ?? [];
    expect(cliente?.de).toBe("cliente");
    expect(cliente?.texto).not.toContain("99999-1234");
    expect(cliente?.texto).not.toContain("joana@exemplo.com");
    expect(cliente?.texto).toContain("[TELEFONE]");
    expect(agente).toMatchObject({ de: "agente", texto: "Claro, te dou 20% de desconto!" });
  });

  it("conteudoDaLinha tira o que não é conteúdo (o schema é estrito)", () => {
    const c = conteudoDaLinha({ id: "x", status: "draft", version_number: 3, system_prompt: "p", credential_id: null, trigger_config: null });
    expect(c).toEqual({ system_prompt: "p", credential_id: null });
  });
});

describe("aplicarCorrecao", () => {
  it("base publicada: nasce um rascunho v2 com o resumo, e nada é publicado", async () => {
    const { admin, escritas } = cenario();
    const r = await aplicarCorrecao(admin as never, ctx, AGENTE, { problema: PROBLEMA, proposta: proposta(), aceitar_prompt: true });
    expect(r).toMatchObject({ ok: true, version_number: 2, atualizou_rascunho: false });

    const insert = escritas.find((e) => e.tabela === "ai_agent_versions" && e.tipo === "insert");
    expect(insert?.linha).toMatchObject({
      organization_id: ORG,
      agent_id: AGENTE,
      status: "draft",
      version_number: 2,
      change_summary: `Correção com IA: ${PROBLEMA}`,
      system_prompt: expect.stringContaining("ofereça o parcelamento"),
      // O resto da base viaja junto.
      channel_session_id: CANAL,
      knowledge_source_ids: [MATERIAL],
    });
    // Nada de publicar: nenhum update em ai_agents nem em versão publicada.
    expect(escritas.some((e) => e.tabela === "ai_agents")).toBe(false);
    expect(escritas.some((e) => e.tipo === "update")).toBe(false);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ai_agent.correcao_aplicada", organizationId: ORG }),
    );
  });

  it("base rascunho: o próprio rascunho é atualizado, filtrado por organização e status", async () => {
    const { admin, escritas } = cenario({ comRascunho: true });
    const r = await aplicarCorrecao(admin as never, ctx, AGENTE, {
      problema: PROBLEMA,
      proposta: proposta({ base_version_id: V_RASCUNHO }),
      aceitar_prompt: true,
    });
    expect(r).toMatchObject({ ok: true, version_id: V_RASCUNHO, atualizou_rascunho: true });
    const update = escritas.find((e) => e.tabela === "ai_agent_versions" && e.tipo === "update");
    expect(update?.filtros).toMatchObject({ id: V_RASCUNHO, organization_id: ORG, status: "draft" });
    expect(escritas.some((e) => e.tipo === "insert")).toBe(false);
  });

  it("a base mudou depois da proposta: 409 e nenhuma escrita", async () => {
    const { admin, escritas } = cenario({ comRascunho: true });
    const r = await aplicarCorrecao(admin as never, ctx, AGENTE, { problema: PROBLEMA, proposta: proposta(), aceitar_prompt: true });
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(escritas).toHaveLength(0);
    expect(criarMaterialDeTexto).not.toHaveBeenCalled();
  });

  it("prompt recusado: as outras mudanças valem, o prompt fica o da base", async () => {
    const { admin, escritas } = cenario();
    const r = await aplicarCorrecao(admin as never, ctx, AGENTE, {
      problema: PROBLEMA,
      proposta: proposta({ frases_de_passagem_adicionar: ["gerente"] }),
      aceitar_prompt: false,
    });
    expect(r.ok).toBe(true);
    const linha = escritas.find((e) => e.tipo === "insert")?.linha;
    expect(linha?.system_prompt).toBe(versao({}).system_prompt);
    expect(linha?.handoff_keywords).toEqual(["atendente", "gerente"]);
  });

  it("nada marcado: 422, nada gravado", async () => {
    const { admin, escritas } = cenario();
    const r = await aplicarCorrecao(admin as never, ctx, AGENTE, { problema: PROBLEMA, proposta: proposta(), aceitar_prompt: false });
    expect(r).toMatchObject({ ok: false, status: 422 });
    expect(escritas).toHaveLength(0);
  });

  it("material novo é criado na organização e entra no acervo; o desligado sai", async () => {
    const { admin, escritas } = cenario();
    const r = await aplicarCorrecao(admin as never, ctx, AGENTE, {
      problema: PROBLEMA,
      proposta: proposta({
        materiais_novos: [{ tipo: "documento", nome: "Formas de pagamento", texto: "Pix e cartão em até 3x.", por_que: "" }],
        materiais_desligar: [{ valor: MATERIAL, por_que: "Desatualizado." }],
      }),
      aceitar_prompt: true,
    });
    expect(r).toMatchObject({ ok: true, materiais: [{ id: MATERIAL_NOVO }] });
    expect(criarMaterialDeTexto).toHaveBeenCalledWith(expect.anything(), ORG, expect.objectContaining({ renomearSeEmUso: true }));
    expect(escritas.find((e) => e.tipo === "insert")?.linha.knowledge_source_ids).toEqual([MATERIAL_NOVO]);
  });

  it("capacidades além do teto: 422 antes de qualquer escrita", async () => {
    const { admin, escritas } = cenario();
    const r = await aplicarCorrecao(admin as never, ctx, AGENTE, {
      problema: PROBLEMA,
      proposta: proposta({ pacotes_ligar: [{ valor: "organizar", por_que: "" }] }),
      aceitar_prompt: true,
    });
    expect(r).toMatchObject({ ok: false, status: 422 });
    expect(escritas).toHaveLength(0);
  });

  it("agente de outra organização: 404, nada gravado", async () => {
    const { admin, escritas } = cenario();
    const r = await aplicarCorrecao(admin as never, { ...ctx, organizationId: OUTRA_ORG }, AGENTE, {
      problema: PROBLEMA,
      proposta: proposta(),
      aceitar_prompt: true,
    });
    expect(r).toMatchObject({ ok: false, status: 404 });
    expect(escritas).toHaveLength(0);
  });
});
