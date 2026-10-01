import { beforeEach, describe, expect, it, vi } from "vitest";

const downloadMock = vi.fn();
const updateEqMock = vi.fn();
const messageRow = {
  id: "msg1",
  organization_id: "org1",
  type: "audio" as string,
  media_mime: "audio/ogg",
  media_storage_path: "org1/conv1/msg1.ogg",
  media_derived_status: null as string | null,
};

/**
 * O dublê PRECISA saber em que tabela está.
 *
 * A versão anterior devolvia `messageRow` para qualquer `from(...)` e encadeava
 * exatamente dois `.eq`. Isso a tornava frágil nos dois eixos: o worker passou a
 * consultar `ai_purpose_bindings` (com três filtros) e o stub quebrava no
 * terceiro `.eq` — falha que aparece como "status error" e aponta para o lugar
 * errado. O Proxy devolve o chain para qualquer filtro, e a linha vem por
 * tabela: mensagem para `messages`, NENHUM binding para `ai_purpose_bindings`
 * (o caso "ninguém configurou nada", que é o comportamento anterior que estes
 * casos existem para preservar).
 */
const bindingDeVisao: { provider: string; model_id: string; credential_id: string | null } | null = null;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => {
      const linha = tabela === "ai_purpose_bindings" ? bindingDeVisao : messageRow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const terminais: any = {
        maybeSingle: async () => ({ data: linha, error: null }),
        single: async () => ({ data: linha, error: null }),
        update: (patch: Record<string, unknown>) => {
          updateEqMock(patch);
          return { eq: () => ({ eq: async () => ({ error: null }) }) };
        },
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: linha ? [linha] : [], error: null }).then(resolve),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = new Proxy(terminais, {
        get: (alvo, prop) =>
          prop in alvo ? alvo[prop as keyof typeof alvo] : () => chain,
      });
      return chain;
    },
    storage: { from: () => ({ download: downloadMock }) },
  }),
}));

vi.mock("@/lib/messaging/media/derive", () => ({
  deriveMediaText: vi.fn(async () => "transcrição do áudio real"),
}));

// resolveOrgLlmConfig e generateText mockados: o worker precisa de credencial p/
// montar as deps, mas o teste não exercita rede.
vi.mock("@/lib/agent-engine/edge/llm/credentials", () => ({
  resolveOrgLlmConfig: vi.fn(async () => ({
    provider: "openai",
    apiKey: "sk-test",
    defaultModel: "gpt-5",
    params: {},
    enabledModels: [],
    orcamento: { modo: "off", tetoCents: 0, efetivoEm: null, limiarPct: 80 },
    orcamentoIndisponivelPorque: null,
  })),
}));

import { deriveMessageMedia, MARCADOR_NAO_LIDA } from "@/workers/media-derive-worker";
import { deriveMediaText } from "@/lib/messaging/media/derive";

function eventRow(attempts = 0) {
  return {
    id: "ev1",
    organization_id: "org1",
    event_type: "media.derive_requested",
    entity_kind: "message",
    entity_id: "msg1",
    payload: { message_id: "msg1" },
    metadata: {},
    consumed_by: [],
    attempts,
  };
}

describe("deriveMessageMedia", () => {
  beforeEach(() => {
    downloadMock.mockReset().mockResolvedValue({ data: new Blob([new Uint8Array([1, 2, 3])]), error: null });
    updateEqMock.mockReset();
    messageRow.media_derived_status = null;
    messageRow.type = "audio";
    vi.mocked(deriveMediaText).mockReset().mockResolvedValue("transcrição do áudio real");
  });

  it("baixa a mídia, deriva e grava ready", async () => {
    const r = await deriveMessageMedia(eventRow());
    expect(r.status).toBe("ok");
    expect(updateEqMock).toHaveBeenCalledWith(
      expect.objectContaining({ media_derived_text: "transcrição do áudio real", media_derived_status: "ready" }),
    );
  });

  it("pula se já derivado (idempotência)", async () => {
    messageRow.media_derived_status = "ready";
    const r = await deriveMessageMedia(eventRow());
    expect(r.status).toBe("skipped");
    expect(deriveMediaText).not.toHaveBeenCalled();
  });

  it("tipo sem derivado (sticker) → skipped sem baixar", async () => {
    messageRow.type = "sticker";
    const r = await deriveMessageMedia(eventRow());
    expect(r.status).toBe("skipped");
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it("org só com OpenRouter: o áudio é transcrito pela OpenRouter, não vira 'não consegui abrir'", async () => {
    // A org da GESTALT SUPORTE em 2026-10-01: OpenRouter como provedor, nenhuma
    // credencial da OpenAI e nenhuma OPENAI_API_KEY na instalação.
    const { resolveOrgLlmConfig } = await import("@/lib/agent-engine/edge/llm/credentials");
    const base = await vi.mocked(resolveOrgLlmConfig).getMockImplementation()!(
      undefined as never, undefined as never, "org1",
    );
    vi.mocked(resolveOrgLlmConfig).mockImplementation(async (_db, _cfg, _org, override) => {
      if (override?.provider === "openai") throw new Error("sem credencial openai");
      return { ...base, provider: "openrouter", apiKey: "sk-or-org", defaultModel: "openai/gpt-6-luna-pro" };
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: "quero o plano" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(deriveMediaText).mockImplementation(async (_tipo, buf, mime, deps) =>
      deps.transcriber.transcribe(buf, mime),
    );
    try {
      const r = await deriveMessageMedia(eventRow());
      expect(r.status).toBe("ok");
      expect(updateEqMock).toHaveBeenCalledWith(
        expect.objectContaining({ media_derived_text: "quero o plano", media_derived_status: "ready" }),
      );
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(String(url)).toBe("https://openrouter.ai/api/v1/audio/transcriptions");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-or-org");
    } finally {
      vi.unstubAllGlobals();
      vi.mocked(resolveOrgLlmConfig).mockImplementation(async () => base);
    }
  });

  it("padrão da org sem chave (anthropic) não derruba o áudio: transcreve pela OpenRouter", async () => {
    // Exatamente a GESTALT SUPORTE em 2026-10-01: `settings.llm` aponta para
    // anthropic/claude-sonnet-5, mas a única chave é da OpenRouter. O resolver
    // SEM override lançava "org sem credencial LLM utilizável" e o evento
    // morria em 5 tentativas antes de chegar à transcrição.
    const { resolveOrgLlmConfig } = await import("@/lib/agent-engine/edge/llm/credentials");
    const base = await vi.mocked(resolveOrgLlmConfig).getMockImplementation()!(
      undefined as never, undefined as never, "org1",
    );
    vi.mocked(resolveOrgLlmConfig).mockImplementation(async (_db, _cfg, _org, override) => {
      if (override?.provider === "openrouter") {
        return { ...base, provider: "openrouter", apiKey: "sk-or-org", defaultModel: null };
      }
      throw new Error("org sem credencial LLM utilizável");
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: "oi, tudo bem" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(deriveMediaText).mockImplementation(async (_tipo, buf, mime, deps) =>
      deps.transcriber.transcribe(buf, mime),
    );
    try {
      const r = await deriveMessageMedia(eventRow());
      expect(r.status).toBe("ok");
      expect(updateEqMock).toHaveBeenCalledWith(
        expect.objectContaining({ media_derived_text: "oi, tudo bem", media_derived_status: "ready" }),
      );
      expect(String(fetchMock.mock.calls[0]![0])).toBe("https://openrouter.ai/api/v1/audio/transcriptions");
    } finally {
      vi.unstubAllGlobals();
      vi.mocked(resolveOrgLlmConfig).mockImplementation(async () => base);
    }
  });

  it("padrão da org sem chave e imagem sem modelo: devolve o marcador em vez de morrer", async () => {
    const { resolveOrgLlmConfig } = await import("@/lib/agent-engine/edge/llm/credentials");
    const base = await vi.mocked(resolveOrgLlmConfig).getMockImplementation()!(
      undefined as never, undefined as never, "org1",
    );
    vi.mocked(resolveOrgLlmConfig).mockRejectedValue(new Error("org sem credencial LLM utilizável"));
    messageRow.type = "image";
    vi.mocked(deriveMediaText).mockImplementation(async (_tipo, buf, mime, deps) =>
      deps.describeImage(buf, mime),
    );
    try {
      const r = await deriveMessageMedia(eventRow());
      expect(r.status).toBe("ok");
      expect(updateEqMock).toHaveBeenCalledWith(
        expect.objectContaining({ media_derived_text: MARCADOR_NAO_LIDA, media_derived_status: "ready" }),
      );
    } finally {
      vi.mocked(resolveOrgLlmConfig).mockReset().mockImplementation(async () => base);
    }
  });

  it("erro na derivação marca failed no último attempt", async () => {
    vi.mocked(deriveMediaText).mockRejectedValue(new Error("transcription_503"));
    const r = await deriveMessageMedia(eventRow(4));
    expect(r.status).toBe("error");
    expect(updateEqMock).toHaveBeenCalledWith(
      expect.objectContaining({ media_derived_status: "failed" }),
    );
  });
});
