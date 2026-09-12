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

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/channels/stevo/credentials", async (original) => {
  const real = (await original()) as Record<string, unknown>;
  return {
    ...real,
    stevoBaseUrlOficial: () => "https://gateway.exemplo",
    resolveEnvioStevo: vi.fn(async () => consulta.data),
  };
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  decifrar.mockClear();
  consulta.data = { transporte: "gateway", token: "token-do-gateway" };
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ messages: [{ id: "wamid.ABC" }] }),
  }));
  vi.stubGlobal("fetch", fetchMock);
});

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

    const [url, init] = fetchMock.mock.calls[0]!;
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

    const corpo = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(corpo.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual([
      "um",
      "dois",
      "dez",
    ]);
  });

  it("⭐ modelo SEM parâmetro não leva `components` — array vazio é recusado", async () => {
    const a = await adapter();
    await a.sendTemplate!({ ...PEDIDO, values: {} });

    const corpo = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
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

    const corpo = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
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

    const corpo = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(corpo.template.components[0].parameters).toHaveLength(1);
  });

  it("não manda `messaging_product`: quem o acrescenta é o gateway", async () => {
    const a = await adapter();
    await a.sendTemplate!(PEDIDO);

    const corpo = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
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
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => ({ meta: { error: { code: 132000, message: "param mismatch" } } }),
    });
    const a = await adapter();

    await expect(a.sendTemplate!(PEDIDO)).rejects.toThrow(/132000/u);
  });
});
