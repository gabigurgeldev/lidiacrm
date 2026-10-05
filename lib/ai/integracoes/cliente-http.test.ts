import { describe, expect, it, vi } from "vitest";

import { TETO_DE_BYTES, chamarEndpoint, type OpcoesDaChamada } from "./cliente-http";

const destinoOk = async () => undefined;

function opcoes(over: Partial<OpcoesDaChamada> = {}): OpcoesDaChamada {
  return {
    metodo: "GET",
    url: "https://api.sistema.com/x",
    corpo: null,
    auth: { auth_tipo: "bearer", auth_header_nome: null },
    segredo: "seg-123",
    timeoutMs: 2000,
    conferirDestino: destinoOk,
    ...over,
  };
}

describe("chamarEndpoint — a única porta de saída", () => {
  it("manda o bearer, não segue redirect e devolve o JSON", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.redirect).toBe("manual");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer seg-123");
      return new Response(JSON.stringify({ ok: true, n: 1 }), { status: 200 });
    });
    const r = await chamarEndpoint(opcoes({ fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(r).toMatchObject({ ok: true, http_status: 200, dados: { ok: true, n: 1 }, erro_codigo: null });
  });

  it("3xx vira redirect_nao_seguido", async () => {
    const fetchImpl = async () => new Response(null, { status: 302, headers: { Location: "http://169.254.169.254/" } });
    const r = await chamarEndpoint(opcoes({ fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(r).toMatchObject({ ok: false, erro_codigo: "redirect_nao_seguido", http_status: 302 });
  });

  it("host privado é recusado antes de qualquer rede", async () => {
    const fetchImpl = vi.fn();
    const r = await chamarEndpoint(
      opcoes({ url: "http://127.0.0.1:5432/x", fetchImpl: fetchImpl as unknown as typeof fetch, conferirDestino: undefined }),
    );
    expect(r.ok).toBe(false);
    expect(r.erro_codigo).toMatch(/^unsafe_url/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("nome que resolve para IP interno é recusado (guarda resolvida)", async () => {
    const fetchImpl = vi.fn();
    const r = await chamarEndpoint(
      opcoes({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        conferirDestino: async () => {
          throw new Error("unsafe_url:private_ip");
        },
      }),
    );
    expect(r).toMatchObject({ ok: false, erro_codigo: "unsafe_url:private_ip" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("resposta maior que o teto é cortada e recusada", async () => {
    const grande = "x".repeat(TETO_DE_BYTES + 10);
    const fetchImpl = async () => new Response(grande, { status: 200 });
    const r = await chamarEndpoint(opcoes({ fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(r).toMatchObject({ ok: false, erro_codigo: "resposta_grande_demais" });
  });

  it("timeout vira erro legível", async () => {
    const fetchImpl = async () => {
      const e = new Error("t");
      e.name = "TimeoutError";
      throw e;
    };
    const r = await chamarEndpoint(opcoes({ fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(r).toMatchObject({ ok: false, erro_codigo: "timeout" });
  });

  it("auth exige segredo cadastrado", async () => {
    const fetchImpl = vi.fn();
    const r = await chamarEndpoint(opcoes({ segredo: null, fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(r).toMatchObject({ ok: false, erro_codigo: "sem_segredo" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("suporte_v1 assina e manda o e-mail verificado e a idempotência", async () => {
    let headers: Record<string, string> = {};
    const fetchImpl = async (_u: unknown, init?: RequestInit) => {
      headers = init?.headers as Record<string, string>;
      return new Response("{}", { status: 200 });
    };
    await chamarEndpoint(
      opcoes({
        metodo: "POST",
        corpo: "{}",
        auth: { auth_tipo: "suporte_v1", auth_header_nome: null },
        emailVerificado: "dono@loja.com",
        idempotencia: "acao-1",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    );
    expect(headers["X-Suporte-Signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(headers["X-Suporte-Email-Verificado"]).toBe("dono@loja.com");
    expect(headers["Idempotency-Key"]).toBe("acao-1");
  });

  it("texto que não é JSON volta cortado em 2 KB", async () => {
    const fetchImpl = async () => new Response("y".repeat(5000), { status: 500 });
    const r = await chamarEndpoint(opcoes({ fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(r.erro_codigo).toBe("http_500");
    expect(String(r.dados).length).toBe(2048);
  });
});
