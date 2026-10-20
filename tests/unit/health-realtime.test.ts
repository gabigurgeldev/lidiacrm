import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O HEALTH ENXERGA O REALTIME FORA — E NÃO CHAMA ISSO DE "SISTEMA FORA DO AR".
 *
 * Em 2026-10-20 o Realtime da produção ficou 100% fora (o Kong não resolvia
 * `realtime-dev.supabase-realtime` e devolvia 503 a todo websocket) enquanto
 * `/api/v1/health` respondia "healthy": o único check do Supabase passa pelo
 * `/rest/v1`, que vai a outro upstream. As telas só deixaram de atualizar ao
 * vivo, e ninguém foi avisado.
 *
 * Os dois lados importam. Um check que não vê a queda é o defeito original; um
 * check que a promove a `down` faz a rota responder 503, e o vigia da VPS manda
 * "PRODUÇÃO FORA DO AR" para um CRM que está atendendo — alarme falso ensina a
 * ignorar o alarme.
 */

vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://supabase.exemplo.test",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-de-teste",
    UPSTASH_REDIS_REST_URL: "https://redis.exemplo.test",
    UPSTASH_REDIS_REST_TOKEN: "tok",
    WAHA_API_BASE_URL: "https://waha.exemplo.test",
    WAHA_API_KEY: "k",
    INTERNAL_CRON_SECRET: "",
    INTERNAL_SECRET: "",
  },
}));
vi.mock("@/lib/crypto/aes_gcm", () => ({ chaveDeCifragemUtilizavel: () => ({ ok: true }) }));

type Resposta = { status: number; body?: string } | Error;

let realtime: Resposta;
const chamadas: { url: string; headers: Record<string, string> }[] = [];

beforeEach(() => {
  chamadas.length = 0;
  realtime = { status: 200, body: '{"message":"Success"}' };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      chamadas.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      if (url.includes("/realtime/")) {
        if (realtime instanceof Error) throw realtime;
        return new Response(realtime.body ?? "", { status: realtime.status });
      }
      return new Response("[]", { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function sondar() {
  const { GET } = await import("@/app/api/v1/health/route");
  const res = await GET(new NextRequest("https://crm.exemplo.test/api/v1/health"));
  const json = (await res.json()) as {
    data: { status: string; checks: Record<string, { status: string; error?: string; reason?: string; target?: string }> };
  };
  return { http: res.status, ...json.data };
}

describe("health — check do Realtime", () => {
  it("Realtime de pé: check ok e sistema healthy", async () => {
    const r = await sondar();
    expect(r.checks.realtime?.status).toBe("ok");
    expect(r.status).toBe("healthy");
    expect(r.http).toBe(200);
  });

  it("sonda pelo caminho do Kong, com a anon key em header e nunca na URL", async () => {
    await sondar();
    const c = chamadas.find((x) => x.url.includes("/realtime/"));
    expect(c?.url).toBe("https://supabase.exemplo.test/realtime/v1/api/ping");
    expect(c?.headers.apikey).toBe("anon-de-teste");
    expect(c?.url).not.toContain("anon-de-teste");
  });

  it("503 do Kong (a queda de 2026-10-20): degraded, e a rota segue 200", async () => {
    realtime = { status: 503, body: '{"message":"name resolution failed"}' };
    const r = await sondar();
    expect(r.checks.realtime).toMatchObject({ status: "degraded", error: "http_503", reason: "resposta_inesperada" });
    expect(r.status).toBe("degraded");
    expect(r.http).toBe(200);
  });

  it("chave recusada vira credencial_recusada, não queda", async () => {
    realtime = { status: 401 };
    const r = await sondar();
    expect(r.checks.realtime).toMatchObject({ status: "degraded", reason: "credencial_recusada" });
  });

  it("falha de rede também é degraded, com a causa classificada", async () => {
    realtime = new Error("timeout after 3000ms");
    const r = await sondar();
    expect(r.checks.realtime?.status).toBe("degraded");
    expect(r.checks.realtime?.reason).toBeTruthy();
    expect(r.http).toBe(200);
  });

  it("o endereço não sai sem o segredo interno", async () => {
    realtime = { status: 503 };
    const r = await sondar();
    expect(r.checks.realtime?.target).toBeUndefined();
  });
});
