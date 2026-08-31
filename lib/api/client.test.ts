import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("apiClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("t1: POST injects Idempotency-Key (uuid) and X-Request-Id headers", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { ok: true } }));
    await apiClient.post("/x", { a: 1 });
    const headers = fetchMock.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers["X-Request-Id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(headers["Idempotency-Key"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("t2: GET injects X-Request-Id but NOT Idempotency-Key", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { ok: true } }));
    await apiClient.get("/x");
    const headers = fetchMock.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers["X-Request-Id"]).toBeTruthy();
    expect(headers["Idempotency-Key"]).toBeUndefined();
  });

  it("t3: 200 response returns parsed JSON", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { hello: "world" } }));
    const result = await apiClient.get<{ data: { hello: string } }>("/x");
    expect(result).toEqual({ data: { hello: "world" } });
  });

  it("t4: 422 response throws ApiError with status, code, and fieldErrors in details", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(422, {
        error: {
          code: "validation_error",
          message: "Validation failed",
          details: { fieldErrors: { name: ["Required"] } },
        },
      }),
    );
    await expect(apiClient.post("/x", {})).rejects.toMatchObject({
      status: 422,
      code: "validation_error",
      details: { fieldErrors: { name: ["Required"] } },
    });
  });

  it("t5: 500 response throws ApiError immediately (no retry)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(500, { error: { code: "internal_error", message: "boom" } }),
    );
    await expect(apiClient.get("/x")).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("t6: 429 with Retry-After=1 retries once and succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          429,
          { error: { code: "rate_limited", message: "slow down" } },
          { "Retry-After": "1" },
        ),
      )
      .mockResolvedValueOnce(jsonResponse(200, { data: { ok: true } }));
    const result = await apiClient.get<{ data: { ok: boolean } }>("/x");
    expect(result).toEqual({ data: { ok: true } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("t7: opts.idempotencyKey overrides auto-uuid", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { ok: true } }));
    await apiClient.post("/x", { a: 1 }, { idempotencyKey: "custom-key-123" });
    const headers = fetchMock.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("custom-key-123");
  });

  /**
   * A página de erro do proxy NÃO é mensagem de usuário.
   *
   * Visto em produção: durante a troca de contêiner de um deploy, o proxy
   * respondeu a própria página ("Service is not reachable"), o cliente usou o
   * corpo cru como `message`, e o construtor de fluxo renderizou um
   * `<!DOCTYPE html>` inteiro — com SVG, gradientes e links — dentro do balão
   * de erro. Quem viu não tinha como saber que bastava tentar de novo.
   */
  it("t8: corpo HTML de proxy não vira mensagem de tela — vira frase acionável", async () => {
    const paginaDoProxy =
      '<!DOCTYPE html> <html lang="en"> <head><title>Not Found</title></head>' +
      "<body><div>Service is not reachable</div></body></html>";
    // 500 e não 502: aqui interessa provar a recusa do HTML, sem o retry.
    //
    // `mockImplementation` e não `mockResolvedValue`: o corpo de uma Response só
    // pode ser lido UMA vez, então devolver sempre a mesma instância faria a
    // segunda chamada ler vazio — e o teste passaria a medir o próprio defeito.
    fetchMock.mockImplementation(() => Promise.resolve(new Response(paginaDoProxy, { status: 500 })));

    await expect(apiClient.get("/x")).rejects.toMatchObject({
      status: 500,
      message: expect.not.stringContaining("<"),
    });

    // O corpo não se perde — deixa de ser interface e vira material de depuração.
    await apiClient.get("/x").catch((err: ApiError) => {
      expect(err.message).not.toContain("DOCTYPE");
      expect(err.details?.corpo_bruto).toContain("Service is not reachable");
    });
  });

  it("t9: 502 de PROXY é tentado de novo — é a janela em que o deploy troca o contêiner", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("<html>bad gateway</html>", { status: 502 }))
      .mockResolvedValueOnce(jsonResponse(200, { data: { ok: true } }));

    const r = await apiClient.get<{ data: { ok: boolean } }>("/x");
    expect(r).toEqual({ data: { ok: true } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  /**
   * O mesmo 502, vindo de nós, NÃO é repetido — e a diferença é dinheiro.
   *
   * `flows/[id]/ai/interpretar` responde 502 com `ai_provider_error` quando o
   * modelo recusa. Tratar esse número como sempre-retentável (foi o primeiro
   * desenho, e este teste existe por causa dele) faria três chamadas ao modelo,
   * três vezes o custo e a espera, para chegar à mesma recusa.
   */
  it("t9b: 502 com corpo de erro NOSSO não é repetido — repetir custaria três chamadas ao modelo", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(502, {
        error: { code: "ai_provider_error", message: "Não consegui entender o pedido." },
      }),
    );

    await expect(apiClient.get("/x")).rejects.toMatchObject({
      status: 502,
      code: "ai_provider_error",
      message: "Não consegui entender o pedido.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("t10: texto de erro curto e legível CONTINUA sendo mostrado", async () => {
    // A recusa é do despejo de página, não de toda resposta não-JSON: uma frase
    // curta do servidor ainda é a melhor mensagem disponível.
    fetchMock.mockResolvedValue(new Response("limite da conta excedido", { status: 400 }));
    await expect(apiClient.get("/x")).rejects.toMatchObject({
      message: "limite da conta excedido",
    });
  });
});
