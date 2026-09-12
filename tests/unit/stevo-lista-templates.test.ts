/**
 * A LISTAGEM DE DEFINIÇÕES DO CANAL INTERMEDIADO OFICIAL.
 *
 * ─── O que faltava ──────────────────────────────────────────────────────────
 *
 * O adapter ganhou `sendTemplate` e não ganhou `templates`. Efeito na tela: o
 * bloco de fluxo oferecia "usar um modelo aprovado", o operador escolhia a
 * conexão, e a lista vinha VAZIA — porque a rota lê o espelho local e nada
 * escrevia ali para este canal. A conta estava cheia de modelos aprovados.
 *
 * ─── O endereço foi MEDIDO, não deduzido ────────────────────────────────────
 *
 * `GET /v1/templates` responde `401 unauthorized` (rota existe, falta token) e
 * `GET /v1/message_templates` — o nome da Graph API — responde
 * `404 Route not found`. Confirmado depois no OpenAPI publicado do gateway
 * (`doc.stevo.chat/api/whatsapp-oficial.v1.yaml`), que documenta o corpo como o
 * CRU da Meta: `{ data: [...] }`.
 *
 * Este arquivo prende o endereço e o formato: escolher o nome errado devolve
 * 404, e o sintoma volta a ser uma lista vazia sem explicação.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const envio = { data: null as unknown };

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/channels/stevo/credentials", async (original) => {
  const real = (await original()) as Record<string, unknown>;
  return {
    ...real,
    stevoBaseUrlOficial: () => "https://gateway.exemplo",
    resolveEnvioStevo: vi.fn(async () => envio.data),
  };
});

let fetchMock: ReturnType<typeof vi.fn>;

const CORPO_DA_META = {
  data: [
    {
      name: "confirmacao_pedido",
      language: "pt_BR",
      status: "APPROVED",
      category: "UTILITY",
      components: [{ type: "BODY", text: "Olá {{1}}" }],
      parameter_format: "POSITIONAL",
    },
    { name: "em_revisao", language: "pt_BR", status: "PENDING", components: [] },
  ],
};

beforeEach(() => {
  envio.data = { transporte: "gateway", token: "token-do-gateway" };
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => CORPO_DA_META }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function ops() {
  return (await import("@/lib/channels/stevo/templates")).stevoTemplateOps;
}

const ESCOPO = { organizationId: "org-1", sessionRef: "inst-1" };

describe("listar as definições aprovadas", () => {
  it("⭐ bate em /v1/templates — e NÃO no nome da Graph API, que dá 404", async () => {
    const t = await ops();
    await t.list(ESCOPO);

    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain("https://gateway.exemplo/v1/templates");
    expect(url).not.toContain("message_templates");
  });

  it("⭐ pede os campos, senão a plataforma devolve só o id", async () => {
    // O gateway repassa o comportamento da Meta: sem `fields`, a definição vem
    // sem `components` — e sem eles não há como montar um campo por lacuna.
    const t = await ops();
    await t.list(ESCOPO);

    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain("components");
    expect(url).toContain("status");
    expect(url).toContain("language");
  });

  it("⭐ lê `{ data: [...] }` — o corpo CRU da Meta, não um envelope nosso", async () => {
    const t = await ops();
    const lista = await t.list(ESCOPO);

    expect(lista).toHaveLength(2);
    expect(lista[0]).toMatchObject({
      name: "confirmacao_pedido",
      language: "pt_BR",
      status: "APPROVED",
      parameterFormat: "POSITIONAL",
    });
    expect(lista[0]!.components).toHaveLength(1);
  });

  it("devolve TODOS os estados: filtrar aqui esconderia o que está em revisão", async () => {
    // Quem filtra por APPROVED é a tela de envio. A tela de gestão precisa ver
    // o pendente, senão o operador cria a mesma definição de novo.
    const t = await ops();
    const lista = await t.list(ESCOPO);
    expect(lista.map((x) => x.status)).toEqual(["APPROVED", "PENDING"]);
  });

  it("corpo sem `data` não quebra a tela — devolve lista vazia", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    const t = await ops();
    expect(await t.list(ESCOPO)).toEqual([]);
  });

  it("⭐ conexão por QR recusa com NOME PRÓPRIO, sem chamar a rede", async () => {
    // Número ligado por QR não tem WABA por trás: não existe definição nenhuma.
    // Deixar a chamada sair devolveria 401 e mandaria procurar no lugar errado.
    envio.data = { transporte: "proxy", creds: { baseUrl: "x", apiKey: "y", instanceId: "z" } };
    const t = await ops();

    await expect(t.list(ESCOPO)).rejects.toThrow(/stevo_sem_gateway/u);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("erro da plataforma sobe com o código dela", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => ({ meta: { error: { code: 100, message: "invalid waba" } } }),
    });
    const t = await ops();

    await expect(t.list(ESCOPO)).rejects.toThrow(/meta 100/u);
  });
});

describe("criar e apagar", () => {
  it("criar POSTa em /v1/templates e devolve PENDENTE, que é como ela nasce", async () => {
    const t = await ops();
    const criada = await t.create({
      ...ESCOPO,
      draft: {
        name: "boas_vindas",
        language: "pt_BR",
        category: "MARKETING",
        components: [{ type: "BODY", text: "Olá!" }],
      },
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://gateway.exemplo/v1/templates");
    expect((init as { method: string }).method).toBe("POST");
    expect(criada.status).toBe("PENDING");
  });

  it("apagar é por NOME na query — é o contrato da plataforma", async () => {
    const t = await ops();
    await t.remove({ ...ESCOPO, name: "boas vindas" });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/v1/templates?name=boas%20vindas");
    expect((init as { method: string }).method).toBe("DELETE");
  });

  it("⭐ editar RECUSA com o caminho de volta, em vez de fingir que editou", async () => {
    // O gateway tem get/post/delete em `/v1/templates` e mais nada.
    const t = await ops();
    await expect(t.update({ ...ESCOPO, name: "x", patch: {} })).rejects.toThrow(
      /stevo_template_sem_edicao/u,
    );
  });
});
