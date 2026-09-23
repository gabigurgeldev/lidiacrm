/**
 * QUEM NÃO LIGOU A IA NÃO RECEBE EFEITO DA IA.
 *
 * ## O defeito, medido no banco de produção em 2026-09-23
 *
 * Dos handoffs por `low_sentiment` daquela instalação, **23 de 24 aconteceram
 * em organizações que não têm UMA LINHA em `ai_agents`**. Cinco organizações
 * escalaram conversa por humor; só duas têm agente, e só uma delas tem agente
 * que atende pela régua de `lib/ai/agents/no-ar.ts`.
 *
 * O caminho: `ai-sentiment-worker` carregava o agente apenas para LER
 * `sentiment_threshold`, e com `agent === null` caía no default (0.3) e seguia
 * classificando. A nota baixa emite `ai.sentiment_alert` → handoff → o bot é
 * silenciado com `bot_silenced_until = infinity` → e o cliente recebe "sua
 * conversa entrou na fila".
 *
 * Do lado de fora: uma conta que nunca ligou IA teve os próprios clientes
 * avisados, pela IA, de que entraram numa fila de atendimento — e as conversas
 * ficaram mudas para sempre. Foi essa a reclamação que chegou.
 *
 * ## Por que o teste mede a CHAMADA AO MODELO, e não só o retorno
 *
 * Porque o retorno `skipped` sozinho não distingue "não classificou" de
 * "classificou e descartou". A diferença importa em três moedas: custo de
 * token, latência, e — a que dói — o alerta que sai no meio do caminho. Se o
 * modelo foi chamado, o gate está no lugar errado.
 *
 * ## O que este arquivo NÃO prova
 *
 * Que o handoff em si respeite a ausência de agente por outros caminhos. O
 * `ai-response-worker` (gatilhos G1/G4) já tem a própria porta —
 * `if (!agent) return skip("agent_inactive_or_missing")`, e ela roda ANTES dos
 * gatilhos —, e os caminhos de MCP exigem um agente por construção. O que
 * faltava era só aqui.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const envMock: Record<string, string> = {
  ANTHROPIC_API_KEY: "sk-ant-teste",
  AI_GATEWAY_API_KEY: "",
  AI_GATEWAY_BASE_URL: "",
  OPENROUTER_API_KEY: "",
  OPENROUTER_BASE_URL: "",
  OPENAI_API_KEY: "",
};
vi.mock("@/lib/env", () => ({
  get env() {
    return envMock;
  },
}));

/**
 * O modelo, dublê — e ele é a SONDA deste arquivo.
 *
 * Devolve sempre nota abaixo do limiar: se o worker chegar até aqui sem agente,
 * o alerta sairia de verdade em produção. Contar as chamadas é o que separa
 * "não classificou" de "classificou e jogou fora".
 */
const generateObjectMock = vi.fn(async () => ({
  object: { sentiment_score: 0.1, reasoning_short: "cliente irritado" },
  usage: { inputTokens: 10, outputTokens: 5 },
}));
vi.mock("ai", () => ({ generateObject: (...a: unknown[]) => generateObjectMock(...(a as [])) }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/ai/log-invocation", () => ({ logInvocation: vi.fn() }));
// O resolvedor fala com o banco de credenciais; aqui basta devolver um modelo.
vi.mock("@/lib/ai/gateway-binding", () => ({
  resolverModeloDoPonto: vi.fn(async () => ({ model: {}, modelId: "anthropic/claude-haiku-4-5" })),
}));

import { processSentiment } from "@/workers/ai-sentiment-worker";
import { createAdminClient } from "@/lib/supabase/admin";
import type { EventRow } from "@/lib/event-log/dispatcher";

const ORG = "11111111-1111-4111-8111-111111111111";
const MSG = "22222222-2222-4222-8222-222222222222";
const CONV = "33333333-3333-4333-8333-333333333333";

/** Um agente que ATENDE pela régua: versão publicada, não arquivado. */
const AGENTE_NO_AR = {
  id: "44444444-4444-4444-8444-444444444444",
  config: {},
  kind: "mcp_agent",
  is_active: true,
  published_version_id: "55555555-5555-4555-8555-555555555555",
  archived_at: null,
};

/**
 * Dublê mínimo: `messages` devolve uma inbound com queixa de verdade (para que
 * nada além do gate de agente possa explicar um skip), e `ai_agents` devolve a
 * lista que o caso quiser.
 */
const alertas: string[] = [];

function admin(agentes: unknown[]) {
  const from = (tabela: string) => {
    const chain: Record<string, unknown> = {};
    const devolver = () => chain;
    for (const m of ["select", "eq", "is", "order", "update", "not", "in", "gte", "limit"]) {
      chain[m] = devolver;
    }
    chain["maybeSingle"] = async () => ({
      data:
        tabela === "messages"
          ? {
              id: MSG,
              body: "péssimo atendimento, quero cancelar tudo agora",
              direction: "inbound",
              conversation_id: CONV,
              organization_id: ORG,
              metadata: {},
            }
          : null,
      error: null,
    });
    // `ai_agents` é lido como LISTA: o worker dá `await` no próprio builder.
    chain["then"] = (resolve: (v: unknown) => unknown) =>
      resolve({ data: tabela === "ai_agents" ? agentes : [], error: null });
    return chain;
  };
  /**
   * `rpc` é por onde o alerta SAI (`emit_event`), e por isso ele é gravado em
   * vez de só engolido: é a fronteira entre "o worker mediu o humor" e "o
   * sistema começou a agir sobre o cliente". Sem registrá-lo, o caso de
   * vacuidade provaria que o modelo foi chamado e não que o efeito aconteceu.
   */
  const rpc = async (nome: string, args?: Record<string, unknown>) => {
    if (nome === "emit_event") alertas.push(String(args?.["p_event_type"] ?? ""));
    return { data: null, error: null };
  };
  return { from, rpc } as unknown as ReturnType<typeof createAdminClient>;
}

const evento = {
  organization_id: ORG,
  entity_id: MSG,
  payload: { message_id: MSG, conversation_id: CONV },
} as unknown as EventRow;

beforeEach(() => {
  generateObjectMock.mockClear();
  alertas.length = 0;
});

describe("classificação de humor só existe com agente no ar", () => {
  it("SEM nenhum agente na organização: não classifica e não chama o modelo", () => {
    vi.mocked(createAdminClient).mockReturnValue(admin([]));

    return processSentiment(evento).then((r) => {
      expect(r.skipped).toBe(true);
      expect(r.reason).toBe("sem_agente_no_ar");
      // As duas asserções que valem: sem elas, o worker poderia estar gastando
      // token e — o que chegou ao cliente — emitindo o alerta que vira handoff.
      expect(generateObjectMock).not.toHaveBeenCalled();
      expect(alertas).toEqual([]);
    });
  });

  it("com agente PARADO (sem versão publicada e não é rag_bot): também não classifica", async () => {
    // O caso do meio, e o mais fácil de errar: existe linha em `ai_agents`, mas
    // ela não atende. Um gate escrito como "a organização tem agente?" passaria
    // aqui e deixaria o defeito de pé para quem criou o agente e nunca publicou.
    vi.mocked(createAdminClient).mockReturnValue(
      admin([{ ...AGENTE_NO_AR, published_version_id: null }]),
    );

    const r = await processSentiment(evento);
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe("sem_agente_no_ar");
    expect(generateObjectMock).not.toHaveBeenCalled();
    expect(alertas).toEqual([]);
  });

  it("GUARDA DE VACUIDADE: com agente no ar, classifica normalmente", async () => {
    // Sem este caso, um worker que pulasse SEMPRE passaria nos dois de cima — e
    // a instalação que de fato usa IA perderia a medição de humor em silêncio.
    vi.mocked(createAdminClient).mockReturnValue(admin([AGENTE_NO_AR]));

    const r = await processSentiment(evento);
    expect(r, JSON.stringify(r)).toMatchObject({ skipped: false });
    expect(r.sentiment_score).toBe(0.1);
    expect(generateObjectMock).toHaveBeenCalledTimes(1);
    // E o alerta SAI — é o que prova que os dois casos acima medem a porta, e
    // não um worker quebrado que não classificaria de jeito nenhum.
    expect(alertas).toEqual(["ai.sentiment_alert"]);
  });
});
