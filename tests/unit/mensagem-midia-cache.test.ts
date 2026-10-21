import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cache do redirect da mídia — GET /api/v1/messages/{id}/media.
 *
 * Mesma prova de `contato-avatar-cache.test.ts`, aplicada à mídia: a URL desta
 * rota é o `src` de cada <img>/<audio>/<video> do hilo, e o hilo é relido a
 * cada mensagem que chega. Sem `Cache-Control` o browser refazia sessão +
 * organização + SELECT + `createSignedUrl` por anexo a cada render.
 *
 *  - o 302 carrega `private` e `max-age` positivo;
 *  - `max-age` é MENOR que a vida da assinatura (lida do argumento que o
 *    handler passou, não copiada da constante);
 *  - o 404 de mensagem sem mídia não é cacheado.
 *
 * Os clients são falsificados; o handler roda de verdade.
 */

const SIGNED_URL = "https://storage.example/assinada?token=abc";

let mensagem: Record<string, unknown> | null = null;

const createSignedUrl = vi.fn(async (_caminho: string, _ttlSegundos: number) => ({
  data: { signedUrl: SIGNED_URL },
  error: null,
}));

function chain(): Record<string, unknown> {
  const proxy: Record<string, unknown> = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "maybeSingle" || prop === "single") {
          return async () => ({ data: mensagem, error: null });
        }
        return () => proxy;
      },
    },
  ) as Record<string, unknown>;
  return proxy;
}

vi.mock("@/lib/auth/server", () => ({
  mfaEmDivida: vi.fn(async () => false),
  loadAuthUser: async () => ({ id: "user-1" }),
  resolveActiveOrg: async () => ({ orgId: "org-1" }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    from: () => ({ select: () => chain() }),
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => chain() }),
    storage: { from: () => ({ createSignedUrl }) },
  }),
}));

const { GET } = await import("@/app/api/v1/messages/[id]/media/route");

function chamar(id = "msg-1") {
  return GET({} as never, { params: Promise.resolve({ id }) });
}

describe("GET /api/v1/messages/{id}/media — cache do redirect", () => {
  beforeEach(() => {
    mensagem = {
      id: "msg-1",
      media_url: null,
      media_mime: "image/jpeg",
      media_storage_path: "org-1/media/msg-1.jpg",
      channel_session_id: "sess-1",
      metadata: null,
    };
    createSignedUrl.mockClear();
  });

  it("redireciona para a URL assinada com Cache-Control private", async () => {
    const res = await chamar();
    const cc = res.headers.get("Cache-Control") ?? "";

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(SIGNED_URL);
    expect(cc, "cache compartilhado serviria a mídia de um tenant a outro").toContain("private");
    expect(cc).not.toContain("public");
    expect(Number(/max-age=(\d+)/.exec(cc)?.[1])).toBeGreaterThan(0);
  });

  it("expira o cache ANTES da assinatura, senão o redirect guardado aponta pra URL vencida", async () => {
    const res = await chamar();
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("Cache-Control") ?? "")?.[1]);
    const ttlAssinatura = createSignedUrl.mock.calls[0]?.[1];

    expect(ttlAssinatura, "o handler precisa ter assinado a URL").toBeDefined();
    expect(maxAge).toBeLessThan(ttlAssinatura ?? 0);
  });

  it("não cacheia o 404 de mensagem sem mídia", async () => {
    mensagem = { ...mensagem, media_storage_path: null, media_url: null };
    const res = await chamar();

    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control") ?? "").not.toMatch(/max-age=[1-9]/);
  });
});
