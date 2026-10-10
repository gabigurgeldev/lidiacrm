/**
 * Enquete e lista do lado do ENVIO: o que cada adapter põe no fio.
 *
 * O adapter não decide formato (isso é `formatoDasOpcoes`, coberto em
 * `lib/channels/opcoes-interativas.test.ts`) — aqui se mede só a tradução, e as
 * duas coisas que, se quebrarem, fazem a resposta voltar sem como ser lida:
 * o `rowId`/`id` da linha ser o NOSSO id da opção, e o rótulo inteiro chegar
 * à pessoa mesmo quando o título precisa ser cortado.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { getAdapter } from "@/lib/channels";
import type { OpcoesInterativas } from "@/lib/schemas";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const alvo: Record<string, unknown> = {
      maybeSingle: async () => ({ data: null, error: null }),
    };
    alvo.select = () => alvo;
    alvo.eq = () => alvo;
    alvo.is = () => alvo;
    return { from: () => alvo, rpc: async () => ({ data: null, error: null }) };
  },
}));

const ORG = "00000000-0000-4000-8000-000000000236";

const OPCOES: OpcoesInterativas = {
  pergunta: "Como podemos ajudar?",
  opcoes: [
    { id: "o1", label: "Agendar consulta" },
    { id: "o2", label: "Remarcar uma consulta já marcada" },
  ],
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function stubWaha() {
  vi.stubEnv("WAHA_API_BASE_URL", "http://localhost:3030");
  vi.stubEnv("WAHA_API_KEY", "hash123");
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    const href = String(url);
    if (href.includes("/api/contacts/check-exists")) {
      const phone = new URL(href).searchParams.get("phone") ?? "";
      return Promise.resolve(Response.json({ numberExists: true, chatId: `${phone}@c.us` }));
    }
    return Promise.resolve(Response.json({ id: "true_5531999998888@c.us_3EB0POLL" }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function corpoDe(fetchMock: ReturnType<typeof vi.fn>, endpoint: string) {
  const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith(`/api/${endpoint}`));
  expect(call, `${endpoint} não foi chamado`).toBeTruthy();
  return JSON.parse(String((call![1] as RequestInit).body)) as Record<string, unknown>;
}

describe("canal por QR", () => {
  it("enquete vai para sendPoll com uma escolha só e os rótulos inteiros", async () => {
    const fetchMock = stubWaha();
    const r = await getAdapter("waha").send({
      organizationId: ORG,
      sessionRef: "sessao",
      to: "5531999998888@c.us",
      kind: "poll",
      body: "texto",
      opcoes: OPCOES,
    });
    expect(r.externalId).toBeTruthy();
    const corpo = corpoDe(fetchMock, "sendPoll");
    expect(corpo).toMatchObject({
      session: "sessao",
      poll: {
        name: "Como podemos ajudar?",
        options: ["Agendar consulta", "Remarcar uma consulta já marcada"],
        multipleAnswers: false,
      },
    });
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/api/sendText"))).toBe(false);
  });

  it("lista vai para sendList com rowId = id da opção e rótulo longo na descrição", async () => {
    const fetchMock = stubWaha();
    await getAdapter("waha").send({
      organizationId: ORG,
      sessionRef: "sessao",
      to: "5531999998888@c.us",
      kind: "list",
      body: "texto",
      opcoes: { ...OPCOES, botao: "Escolher" },
    });
    const corpo = corpoDe(fetchMock, "sendList") as {
      message: {
        description: string;
        button: string;
        sections: Array<{ rows: Array<{ title: string; rowId: string; description?: string }> }>;
      };
    };
    expect(corpo.message.description).toBe("Como podemos ajudar?");
    expect(corpo.message.button).toBe("Escolher");
    const rows = corpo.message.sections[0]!.rows;
    expect(rows.map((r) => r.rowId)).toEqual(["o1", "o2"]);
    expect(rows[0]).toEqual({ title: "Agendar consulta", rowId: "o1" });
    // 32 caracteres não cabem em 24: título cortado, rótulo inteiro na descrição.
    expect(Array.from(rows[1]!.title).length).toBeLessThanOrEqual(24);
    expect(rows[1]!.title.endsWith("…")).toBe(true);
    expect(rows[1]!.description).toBe("Remarcar uma consulta já marcada");
  });
});

describe("canal oficial", () => {
  it("lista vira interactive/list com id = id da opção", async () => {
    vi.stubEnv("META_PHONE_NUMBER_ID", "1103328999528818");
    vi.stubEnv("META_SYSTEM_USER_TOKEN", "tok");
    vi.stubEnv("META_GRAPH_VERSION", "v22.0");
    const spy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: "wamid.L" }] }),
    });
    vi.stubGlobal("fetch", spy);

    const r = await getAdapter("meta_cloud").send({
      organizationId: ORG,
      sessionRef: "x",
      to: "5531998966398",
      kind: "list",
      body: "texto",
      opcoes: OPCOES,
    });
    expect(r).toEqual({ externalId: "wamid.L" });
    const corpo = JSON.parse(spy.mock.calls[0]![1].body as string) as {
      type: string;
      interactive: {
        type: string;
        body: { text: string };
        action: { button: string; sections: Array<{ rows: Array<{ id: string; title: string }> }> };
      };
    };
    expect(corpo.type).toBe("interactive");
    expect(corpo.interactive.type).toBe("list");
    expect(corpo.interactive.body.text).toBe("Como podemos ajudar?");
    expect(corpo.interactive.action.button).toBe("Ver opções");
    expect(corpo.interactive.action.sections[0]!.rows.map((x) => x.id)).toEqual(["o1", "o2"]);
  });
});

describe("canais sem suporte", () => {
  it("recusam com nome em vez de mandar só a pergunta", async () => {
    for (const provider of ["zernio", "stevo"] as const) {
      await expect(
        getAdapter(provider).send({
          organizationId: ORG,
          sessionRef: "x",
          to: "5531998966398",
          kind: "poll",
          body: "texto",
          opcoes: OPCOES,
        }),
      ).rejects.toThrow(/opcoes_not_supported/);
    }
  });
});
