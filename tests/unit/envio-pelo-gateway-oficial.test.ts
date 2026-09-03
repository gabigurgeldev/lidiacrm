/**
 * Envio da modalidade OFICIAL pelo gateway.
 *
 * O adapter mandava tudo pelo proxy de gestão, e para instância oficial o proxy
 * responde `409 not_ready` ("Instância da API Oficial sem token — conecte
 * primeiro"): ela não tem servidor de instância para ele proxiar, e fala com a
 * Meta por um gateway separado. Medido na conta de produção, onde toda
 * instância oficial devolve `token: null` e toda SM v2 devolve preenchido.
 *
 * O que estes testes fixam: o DESTINO e o FORMATO mudam quando há token de
 * gateway gravado, e continuam como eram quando não há.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// `import type * as` e não `typeof import(...)` inline no factory: o inline é
// proibido pela regra `consistent-type-imports`, e um `import type` some na
// compilação — então não carrega o módulo antes do mock.
import type * as ModuloDeCredenciais from "@/lib/channels/stevo/credentials";

const decrypt = vi.hoisted(() => vi.fn());
const credsDaConta = vi.hoisted(() => vi.fn());
const tokenDoGateway = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/webhooks/secrets", () => ({ decryptWebhookSecret: decrypt }));
vi.mock("@/lib/channels/stevo/credentials", async (original) => {
  const real = await original<typeof ModuloDeCredenciais>();
  return {
    ...real,
    resolveStevoCreds: credsDaConta,
    stevoOfficialToken: tokenDoGateway,
  };
});

import { stevoAdapter } from "@/lib/channels/adapters/stevo";

/**
 * `checkHealth` é OPCIONAL em `ChannelAdapter` — nem todo canal sabe responder
 * "você está de pé?". Chamá-lo direto não compila, e um `!` espalhado por cada
 * caso esconderia a pergunta que importa: este adapter implementa, ou não?
 *
 * Aqui ela é feita UMA vez, e o dia em que o adapter deixar de implementar
 * falha com frase, em vez de `undefined is not a function`.
 */
function saudeDo(adapter: typeof stevoAdapter) {
  const fn = adapter.checkHealth;
  if (fn === undefined) throw new Error("o adapter parou de implementar checkHealth");
  return fn.bind(adapter);
}

const ENVELOPE = {
  organizationId: "org-1",
  sessionRef: "inst-1",
  to: "5594981004900",
  kind: "text" as const,
  body: "oi, tudo bem?",
};

describe("envio pelo gateway da API Oficial", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    credsDaConta.mockReset();
    tokenDoGateway.mockReset();
  });

  it("⭐ com token de gateway, manda pro gateway em formato Cloud API — e NÃO pro proxy", async () => {
    tokenDoGateway.mockResolvedValue("sk_of_abc");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: "wamid.XYZ" }] }), { status: 200 }),
    );

    const r = await stevoAdapter.send(ENVELOPE);

    expect(r.externalId).toBe("wamid.XYZ");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe("https://apimeta.shurima.cloud/v1/messages");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer sk_of_abc");

    const corpo = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(corpo).toEqual({ to: "5594981004900", type: "text", text: { body: "oi, tudo bem?" } });
    // O gateway acrescenta este campo; mandá-lo daqui seria duplicá-lo no
    // payload que ele repassa à Meta.
    expect(corpo).not.toHaveProperty("messaging_product");
    // O proxy de gestão não pode ter sido consultado: para instância oficial ele
    // é um 409 certo, e perguntar antes é gastar uma ida à rede para ouvir "não".
    expect(credsDaConta).not.toHaveBeenCalled();
  });

  it("⭐ áudio vira nota de voz (voice: true), não anexo de música", async () => {
    tokenDoGateway.mockResolvedValue("sk_of_abc");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: "wamid.A" }] }), { status: 200 }),
    );

    await stevoAdapter.send({
      ...ENVELOPE,
      kind: "audio",
      media: { url: "https://exemplo/a.ogg", mime: "audio/ogg" },
    });

    const corpo = JSON.parse(String(fetchSpy.mock.calls[0]![1]?.body)) as {
      type: string;
      audio: { link: string; voice: boolean };
    };
    expect(corpo.type).toBe("audio");
    expect(corpo.audio.voice).toBe(true);
  });

  it("⭐ erro do gateway mostra o código da Meta, que é o que diz a ação", async () => {
    tokenDoGateway.mockResolvedValue("sk_of_abc");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "meta_error",
          meta: { error: { code: 131047, message: "Message failed to send outside 24h window" } },
        }),
        { status: 400 },
      ),
    );

    await expect(stevoAdapter.send(ENVELOPE)).rejects.toThrow(/131047/u);
  });

  it("sem token de gateway, o caminho antigo (proxy) continua igual", async () => {
    tokenDoGateway.mockResolvedValue(null);
    credsDaConta.mockResolvedValue({
      instanceId: "inst-1",
      apiKey: "stevo_sk_x",
      baseUrl: "https://openapi.stevo.chat",
      source: "session",
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ sent: true, result: { id: "3EB0" } }), { status: 200 }),
    );

    await stevoAdapter.send(ENVELOPE);

    expect(String(fetchSpy.mock.calls[0]![0])).toBe(
      "https://openapi.stevo.chat/v1/instances/inst-1/messages",
    );
  });
});

describe("saúde da API Oficial pelo gateway", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    credsDaConta.mockReset();
    tokenDoGateway.mockReset();
  });

  it("⭐ número em SANDBOX não é 'funcionando' — entrega só para os de teste", async () => {
    tokenDoGateway.mockResolvedValue("sk_of_abc");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ account_mode: "SANDBOX", quality_rating: "GREEN" }), {
        status: 200,
      }),
    );

    const s = await saudeDo(stevoAdapter)({ organizationId: "org-1", sessionRef: "inst-1" });
    expect(s.status).toBe("STOPPED");
    expect(s.detail).toMatch(/SANDBOX/u);
  });

  it("⭐ token recusado é DESCONECTADO, não 'não deu para perguntar'", async () => {
    tokenDoGateway.mockResolvedValue("sk_of_abc");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 401 }));

    const s = await saudeDo(stevoAdapter)({ organizationId: "org-1", sessionRef: "inst-1" });
    expect(s.reachable).toBe(true);
    expect(s.status).toBe("FAILED");
  });

  it("número LIVE e no verde é funcionando, sem detalhe de ruído", async () => {
    tokenDoGateway.mockResolvedValue("sk_of_abc");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ account_mode: "LIVE", quality_rating: "GREEN" }), {
        status: 200,
      }),
    );

    const s = await saudeDo(stevoAdapter)({ organizationId: "org-1", sessionRef: "inst-1" });
    expect(s).toEqual({ reachable: true, status: "WORKING", detail: null });
  });
});
