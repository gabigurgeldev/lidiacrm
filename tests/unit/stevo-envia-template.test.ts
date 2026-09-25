/**
 * MODELO APROVADO SAI PELA CONEXÃO ESCOLHIDA — não pelo número da Meta.
 *
 * ─── O defeito, e por que ele não parece um defeito ─────────────────────────
 *
 * Sem `sendTemplate` no adapter, `app/api/v1/messages/_handler.ts` cai em
 * `sendTemplateForSession`, que lê `META_PHONE_NUMBER_ID` e
 * `META_SYSTEM_USER_TOKEN` do AMBIENTE. Numa instalação com a conexão
 * intermediada E a plataforma direta configuradas, o modelo escolhido na
 * primeira saía pelo NÚMERO da segunda.
 *
 * Isso não é falha de envio: a mensagem SAI, o cliente recebe, e nada acusa.
 * O que muda é de qual número ela veio — e a resposta do cliente chega na caixa
 * da outra conexão, ou some.
 *
 * `lib/channels/types.ts` descreve esse mesmo defeito como já fechado para o
 * outro canal intermediado. Aqui ele estava aberto, e não havia teste nenhum
 * cobrindo o caminho de template desta conexão.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const decifrar = vi.fn(async () => "token-do-gateway");
const consulta = { data: null as unknown, error: null as unknown };

/** O que o espelho (`meta_templates`) tem para esta conexão. `null` = vazio. */
const espelho = { data: null as unknown };
/** O que a plataforma devolve em `GET /v1/templates`. */
let naPlataforma: unknown[] = [];
/** A resposta do `POST /v1/messages`. */
let respostaDoEnvio: () => unknown;

vi.mock("@/lib/supabase/admin", () => {
  const cadeia: Record<string, unknown> = {};
  cadeia.select = () => cadeia;
  cadeia.eq = () => cadeia;
  cadeia.maybeSingle = async () => ({ data: espelho.data, error: null });
  return { createAdminClient: () => ({ from: () => cadeia }) };
});
vi.mock("@/lib/channels/stevo/credentials", async (original) => {
  const real = (await original()) as Record<string, unknown>;
  return {
    ...real,
    stevoBaseUrlOficial: () => "https://gateway.exemplo",
    resolveEnvioStevo: vi.fn(async () => consulta.data),
  };
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  decifrar.mockClear();
  consulta.data = { transporte: "gateway", token: "token-do-gateway" };
  espelho.data = null;
  naPlataforma = [];
  respostaDoEnvio = () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ messages: [{ id: "wamid.ABC" }] }),
  });
  (await import("@/lib/channels/stevo/componentes-do-modelo")).__limparCacheDeDefinicoes();
  fetchMock = vi.fn(async (url: string) =>
    String(url).includes("/v1/templates")
      ? { ok: true, status: 200, statusText: "OK", json: async () => ({ data: naPlataforma }) }
      : respostaDoEnvio(),
  );
  vi.stubGlobal("fetch", fetchMock);
});

/** A chamada de ENVIO — a busca da definição na plataforma pode vir antes dela. */
function envio(): [string, { body: string; headers: Record<string, string> }] {
  const chamada = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/v1/messages"));
  expect(chamada, "o envio não foi feito").toBeDefined();
  return chamada as [string, { body: string; headers: Record<string, string> }];
}

function listagens(): number {
  return fetchMock.mock.calls.filter(([u]) => String(u).includes("/v1/templates")).length;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function adapter() {
  const mod = await import("@/lib/channels/adapters/stevo");
  return mod.stevoAdapter;
}

const PEDIDO = {
  organizationId: "org-1",
  sessionRef: "inst-1",
  to: "5511999998888",
  name: "confirmacao_pedido",
  language: "pt_BR",
  values: { "1": "Ana", "2": "1234" },
};

describe("modelo aprovado pela conexão intermediada", () => {
  it("⭐ bate no GATEWAY da conexão, e não na Graph API da Meta", async () => {
    const a = await adapter();
    const r = await a.sendTemplate!(PEDIDO);

    const [url, init] = envio();
    expect(url).toBe("https://gateway.exemplo/v1/messages");
    expect(url).not.toContain("graph.facebook.com");
    expect((init as { headers: Record<string, string> }).headers.Authorization).toBe(
      "Bearer token-do-gateway",
    );
    expect(r.externalId).toBe("wamid.ABC");
  });

  it("⭐ os parâmetros entram na ORDEM NUMÉRICA, não na alfabética", async () => {
    // `10` antes de `2` é o que a ordenação por texto produz, e o cliente
    // receberia os valores trocados de lugar — sem erro nenhum.
    const a = await adapter();
    await a.sendTemplate!({
      ...PEDIDO,
      values: { "1": "um", "2": "dois", "10": "dez" },
    });

    const corpo = JSON.parse(envio()[1].body);
    expect(corpo.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual([
      "um",
      "dois",
      "dez",
    ]);
  });

  it("⭐ modelo SEM parâmetro não leva `components` — array vazio é recusado", async () => {
    const a = await adapter();
    await a.sendTemplate!({ ...PEDIDO, values: {} });

    const corpo = JSON.parse(envio()[1].body);
    expect(corpo.template.components).toBeUndefined();
    expect(corpo.template.name).toBe("confirmacao_pedido");
    expect(corpo.template.language).toEqual({ code: "pt_BR" });
  });

  it("⭐ cabeçalho vem ANTES do corpo, e chave sem endereço conhecido fica de fora", async () => {
    // As chaves saem de `slotKey`: corpo sem prefixo, cabeçalho com `header:`.
    // `card0:1` (carrossel) é deixado de fora de propósito — montá-lo de palpite
    // mandaria metade do carrossel errado, e errado que SAI é pior que recusado.
    const a = await adapter();
    await a.sendTemplate!({
      ...PEDIDO,
      values: { "1": "corpo", "header:1": "cabeca", "card0:1": "carrossel" },
    });

    const corpo = JSON.parse(envio()[1].body);
    expect(corpo.template.components.map((c: { type: string }) => c.type)).toEqual([
      "header",
      "body",
    ]);
    const textos = corpo.template.components.flatMap((c: { parameters: { text: string }[] }) =>
      c.parameters.map((p) => p.text),
    );
    expect(textos).toEqual(["cabeca", "corpo"]);
    expect(textos).not.toContain("carrossel");
  });

  it("valor em branco não vira parâmetro vazio — a plataforma recusaria", async () => {
    const a = await adapter();
    await a.sendTemplate!({ ...PEDIDO, values: { "1": "Ana", "2": "   " } });

    const corpo = JSON.parse(envio()[1].body);
    expect(corpo.template.components[0].parameters).toHaveLength(1);
  });

  it("não manda `messaging_product`: quem o acrescenta é o gateway", async () => {
    const a = await adapter();
    await a.sendTemplate!(PEDIDO);

    const corpo = JSON.parse(envio()[1].body);
    expect(corpo.messaging_product).toBeUndefined();
  });

  it("⭐ conexão por QR recusa com NOME PRÓPRIO, e não deixa a plataforma responder", async () => {
    // Número ligado por QR não tem WABA por trás: não existe definição aprovada
    // nenhuma. Quem escolheu o modelo no fluxo precisa saber que a CONEXÃO está
    // errada — um código de erro da plataforma manda procurar no lugar errado.
    consulta.data = { transporte: "proxy", creds: { baseUrl: "x", apiKey: "y", instanceId: "z" } };
    const a = await adapter();

    await expect(a.sendTemplate!(PEDIDO)).rejects.toThrow(/stevo_template_sem_gateway/u);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("erro da plataforma sobe com o código dela, que é o que diz a AÇÃO", async () => {
    respostaDoEnvio = () => ({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => ({ meta: { error: { code: 132000, message: "param mismatch" } } }),
    });
    const a = await adapter();

    await expect(a.sendTemplate!(PEDIDO)).rejects.toThrow(/132000/u);
  });
});

describe("o payload pelo CONTRATO da definição", () => {
  const COM_IMAGEM = {
    name: "confirmacao_pedido",
    language: "pt_BR",
    components: [
      { type: "HEADER", format: "IMAGE" },
      { type: "BODY", text: "Oi {{1}}, seu pedido saiu." },
    ],
  };

  it("⭐ imagem no cabeçalho sai como IMAGEM — como texto a Meta recusa toda mensagem", async () => {
    naPlataforma = [COM_IMAGEM];
    const a = await adapter();
    await a.sendTemplate!({
      ...PEDIDO,
      values: { "header:1": "https://arquivos.exemplo/banner.jpg", "1": "Ana" },
    });

    const corpo = JSON.parse(envio()[1].body);
    expect(corpo.template.components[0]).toEqual({
      type: "header",
      parameters: [{ type: "image", image: { link: "https://arquivos.exemplo/banner.jpg" } }],
    });
    expect(corpo.template.components[1].parameters).toEqual([{ type: "text", text: "Ana" }]);
  });

  it("o espelho responde primeiro, sem ir à plataforma", async () => {
    espelho.data = { ...COM_IMAGEM, parameter_format: null };
    const a = await adapter();
    await a.sendTemplate!({
      ...PEDIDO,
      values: { "header:1": "https://arquivos.exemplo/banner.jpg", "1": "Ana" },
    });

    expect(listagens()).toBe(0);
    expect(JSON.parse(envio()[1].body).template.components[0].parameters[0].type).toBe("image");
  });

  it("⭐ um disparo não lista a plataforma a cada destinatário", async () => {
    naPlataforma = [COM_IMAGEM];
    const a = await adapter();
    const valores = { "header:1": "https://arquivos.exemplo/banner.jpg", "1": "Ana" };
    await a.sendTemplate!({ ...PEDIDO, values: valores });
    await a.sendTemplate!({ ...PEDIDO, to: "5511911112222", values: valores });
    await a.sendTemplate!({ ...PEDIDO, to: "5511933334444", values: valores });

    expect(listagens()).toBe(1);
  });

  it("lacuna sem valor falha AQUI, com o nome dela, em vez de um 132000", async () => {
    naPlataforma = [COM_IMAGEM];
    const a = await adapter();

    await expect(a.sendTemplate!({ ...PEDIDO, values: { "1": "Ana" } })).rejects.toThrow(
      /cabeçalho/u,
    );
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/v1/messages"))).toBe(false);
  });
});
