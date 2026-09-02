/**
 * O ADAPTER DO INTERMEDIÁRIO DE CONTA — tradução de formato, e nada mais.
 *
 * ## O que este arquivo guarda
 *
 * Três coisas que já quebraram em canais irmãos e que aqui têm o mesmo formato
 * de defeito:
 *
 * 1. **`isConfigured` respondendo pelo `.env`.** É a dívida escrita em
 *    `meta-cloud.ts`: a credencial vive na SESSÃO, o método é síncrono e não
 *    pode consultar o banco, então olhar o ambiente responde "não configurado"
 *    para toda instalação que conectou pela tela — e o handler grava `queued`
 *    para sempre, sem erro, com o canal funcionando.
 * 2. **`send` devolvendo `{externalId: null}` quando não há credencial.** O
 *    handler grava `sent` quando `send` não lança; um `null` diria "enviado"
 *    para algo que nunca saiu.
 * 3. **Ler só o status HTTP.** Este contrato tem `sent: false` com 2xx — a
 *    chamada chegou e o motor recusou.
 *
 * ## A asserção que carrega o arquivo
 *
 * A legenda de mídia vai em `caption`, NUNCA em `text`. Com os dois preenchidos
 * o provedor manda duas mensagens, e o cliente recebe a foto e um texto solto
 * repetindo a legenda.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { corpoDeEnvioStevo, idDaRespostaStevo } from "@/lib/channels/stevo/envelope";
import type { OutboundEnvelope } from "@/lib/channels/types";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/channels/stevo/credentials", async (original) => {
  const real = (await original()) as Record<string, unknown>;
  return { ...real, resolveStevoCreds: vi.fn() };
});

const envelope = (over: Partial<OutboundEnvelope> = {}): OutboundEnvelope =>
  ({
    organizationId: "org-1",
    sessionRef: "inst-1",
    to: "5531999998888",
    kind: "text",
    body: "olá",
    ...over,
  }) as OutboundEnvelope;

describe("o corpo do envio", () => {
  it("texto puro vai em `text`", () => {
    expect(corpoDeEnvioStevo(envelope())).toEqual({ to: "5531999998888", text: "olá" });
  });

  it("⭐ mídia com legenda usa `caption` — e NUNCA `text` junto", () => {
    // Os dois preenchidos fazem o provedor mandar DUAS mensagens: a foto e um
    // texto solto repetindo a legenda.
    const corpo = corpoDeEnvioStevo(
      envelope({
        kind: "image",
        body: "olha isto",
        media: { url: "https://x/y.jpg", mime: "image/jpeg" },
      }),
    );
    expect(corpo.caption).toBe("olha isto");
    expect(corpo.text).toBeUndefined();
    expect(corpo.media_type).toBe("image");
  });

  it("áudio é `audio`, documento é `document`, e o desconhecido cai em documento", () => {
    const tipo = (kind: string) =>
      corpoDeEnvioStevo(
        envelope({ kind: kind as OutboundEnvelope["kind"], media: { url: "u", mime: "m" } }),
      ).media_type;
    expect(tipo("audio")).toBe("audio");
    expect(tipo("video")).toBe("video");
    expect(tipo("document")).toBe("document");
    // `sticker` não existe neste contrato. Perder a mensagem seria pior que
    // entregá-la num formato vizinho.
    expect(tipo("sticker")).toBe("document");
  });

  it("o nome do arquivo acompanha o documento", () => {
    const corpo = corpoDeEnvioStevo(
      envelope({
        kind: "document",
        media: { url: "https://x/y.pdf", mime: "application/pdf", filename: "contrato.pdf" },
      }),
    );
    expect(corpo.filename).toBe("contrato.pdf");
  });
});

describe("o id da mensagem na resposta", () => {
  it("acha o id onde quer que ele esteja aninhado", () => {
    // O caminho não é documentado e varia com o motor (oficial devolve `wamid`,
    // o outro devolve a chave do WhatsApp). Um caminho fixo errado devolveria
    // `null` sempre, quebrando o dedup do eco sem nenhum sintoma.
    expect(idDaRespostaStevo({ key: { id: "ABC123" } })).toBe("ABC123");
    expect(idDaRespostaStevo({ messages: [{ id: "wamid.XYZ" }] })).toBe("wamid.XYZ");
    expect(idDaRespostaStevo({ wamid: "direto" })).toBe("direto");
  });

  it("devolve null sem drama quando não há id — e isso NÃO é falha de envio", () => {
    // `sent: true` já disse que saiu. Tratar como erro faria a tela marcar
    // `failed` numa mensagem que o cliente recebeu.
    expect(idDaRespostaStevo({ sent: true })).toBeNull();
    expect(idDaRespostaStevo(null)).toBeNull();
  });
});

describe("o adapter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("⭐ `isConfigured` é true mesmo sem env — a credencial vive na SESSÃO", async () => {
    // A regressão que este caso impede: exigir env aqui faz toda instalação que
    // conectou pela tela ficar com as mensagens paradas em `queued`, sem erro.
    const anterior = process.env.STEVO_API_KEY;
    delete process.env.STEVO_API_KEY;
    const { stevoAdapter } = await import("@/lib/channels/adapters/stevo");
    expect(stevoAdapter.isConfigured()).toBe(true);
    if (anterior !== undefined) process.env.STEVO_API_KEY = anterior;
  });

  it("⭐ `send` LANÇA quando não há credencial — nunca devolve id nulo", async () => {
    const { resolveStevoCreds } = await import("@/lib/channels/stevo/credentials");
    vi.mocked(resolveStevoCreds).mockResolvedValue(null);
    const { stevoAdapter } = await import("@/lib/channels/adapters/stevo");

    // `{externalId: null}` faria o handler gravar `sent` — "enviado" para algo
    // que nunca saiu.
    await expect(stevoAdapter.send(envelope())).rejects.toThrow(/not_configured/);
  });

  it("⭐ `sent: false` com HTTP 200 é FALHA, não sucesso", async () => {
    const { resolveStevoCreds } = await import("@/lib/channels/stevo/credentials");
    vi.mocked(resolveStevoCreds).mockResolvedValue({
      instanceId: "inst-1",
      apiKey: "k",
      baseUrl: "https://provedor.test",
      source: "session",
    });
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ sent: false, error: "numero invalido" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { stevoAdapter } = await import("@/lib/channels/adapters/stevo");
    await expect(stevoAdapter.send(envelope())).rejects.toThrow(/send_failed/);
    vi.unstubAllGlobals();
  });

  it("grupo não tem endereço neste canal", () => {
    // A API de grupos dele é outro recurso, com id próprio. Fingir que um chatId
    // de grupo cabe no campo `to` manda a mensagem para o lugar errado.
    return import("@/lib/channels/adapters/stevo").then(({ stevoAdapter }) => {
      expect(
        stevoAdapter.resolveRecipient({
          isGroup: true,
          groupChatId: "123@g.us",
          phoneNumber: "+5531999998888",
          waIdentity: null,
        }),
      ).toBeNull();
    });
  });

  it("o destinatário é E.164 em dígitos, sem `+` e sem sufixo", async () => {
    const { stevoAdapter } = await import("@/lib/channels/adapters/stevo");
    expect(
      stevoAdapter.resolveRecipient({
        isGroup: false,
        groupChatId: null,
        phoneNumber: "+55 (31) 99999-8888",
        waIdentity: null,
      }),
    ).toBe("5531999998888");
  });
});
