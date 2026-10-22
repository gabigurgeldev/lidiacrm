import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O envio da FOTO DO ACERVO pelo sink do turno (`sendTurnMessage`).
 *
 * Três promessas, cada uma com o seu modo de falha:
 *
 *  1. o caminho da foto vai ao handler pela opção INTERNA, com origem
 *     `material` — nunca em `media_storage_path`, que o redact da LGPD coleta;
 *  2. o material entra na identidade da intenção (hash do ledger): duas fotos
 *     com a mesma legenda não são o mesmo envio;
 *  3. foto nunca vira voz, mesmo com "responder em áudio" ligado.
 */

const sendMessageHandler = vi.hoisted(() => vi.fn());
const insertInboxItem = vi.hoisted(() => vi.fn());

vi.mock("@/app/api/v1/messages/_handler", () => ({ sendMessageHandler }));
vi.mock("@/lib/agent-engine/db/repository", () => ({ insertInboxItem }));

const { sendTurnMessage } = await import("@/lib/agent-engine/edge/crm/send-message");

const ORG = "11111111-1111-4111-8111-111111111111";
const FOTO = {
  materialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  path: `${ORG}/materiais/0f0e0d0c-0b0a-4908-8706-050403020100.jpg`,
  mime: "image/jpeg",
  nome: "Vestido Areia",
};

function fakeDb() {
  const ledgerInserts: unknown[][] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("insert into send_ledger")) {
      ledgerInserts.push(params);
      return { rows: [{ id: `led-${ledgerInserts.length}` }] };
    }
    return { rows: [] };
  });
  return { db: { query } as never, ledgerInserts };
}

function fakeCfg(synthesize = vi.fn()) {
  return {
    supabase: { storage: { from: vi.fn(() => ({ upload: vi.fn() })) } },
    voz: { servico: "kokoro", provider: { synthesize }, maxChars: 800 },
  } as never;
}

function entrada(extra: Record<string, unknown> = {}) {
  return {
    tenantId: ORG,
    leadId: "lead-1",
    jobId: "job-1",
    seq: 1,
    conversationId: "conv-1",
    body: "Essa é a cor Areia!",
    ...extra,
  };
}

beforeEach(() => {
  sendMessageHandler.mockReset();
  sendMessageHandler.mockResolvedValue({ id: "msg-1", status: "sent" });
});

describe("sendTurnMessage com foto do acervo", () => {
  it("⭐ manda type image com a legenda e o caminho pela opção interna de origem material", async () => {
    const { db } = fakeDb();
    const out = await sendTurnMessage(db, fakeCfg(), entrada({ imagem: FOTO }));

    expect(out.kind).toBe("sent");
    const [, , payload, opcoes] = sendMessageHandler.mock.calls[0]!;
    expect(payload).toMatchObject({ conversation_id: "conv-1", type: "image", body: "Essa é a cor Areia!" });
    // O caminho NÃO vai no payload: `media_storage_path` é o que o redact apaga.
    expect(payload).not.toHaveProperty("media_storage_path");
    expect(payload.metadata).toMatchObject({ material: { id: FOTO.materialId, nome: "Vestido Areia" } });
    expect(opcoes).toEqual({ midiaCompartilhada: { path: FOTO.path, mime: "image/jpeg", origem: "material" } });
  });

  it("sem foto, nenhuma mídia compartilhada vai ao handler", async () => {
    const { db } = fakeDb();
    await sendTurnMessage(db, fakeCfg(), entrada());
    const [, , payload, opcoes] = sendMessageHandler.mock.calls[0]!;
    expect(payload.type).toBe("text");
    expect(opcoes).toEqual({});
  });

  it("⭐ o hash do ledger muda com o material — mesma legenda, fotos diferentes", async () => {
    const { db, ledgerInserts } = fakeDb();
    await sendTurnMessage(db, fakeCfg(), entrada({ seq: 1, imagem: FOTO }));
    await sendTurnMessage(
      db,
      fakeCfg(),
      entrada({ seq: 2, imagem: { ...FOTO, materialId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } }),
    );
    await sendTurnMessage(db, fakeCfg(), entrada({ seq: 3 }));

    const hashes = ledgerInserts.map((p) => p[4]);
    expect(new Set(hashes).size).toBe(3);
  });

  it("⭐ foto nunca vira voz, mesmo com responder em áudio ligado", async () => {
    const synthesize = vi.fn();
    const { db } = fakeDb();
    await sendTurnMessage(db, fakeCfg(synthesize), entrada({ imagem: FOTO, voice: { voiceId: "pf_dora" } }));

    expect(synthesize).not.toHaveBeenCalled();
    const [, , payload] = sendMessageHandler.mock.calls[0]!;
    expect(payload.type).toBe("image");
    expect(payload.metadata).not.toHaveProperty("voz");
  });
});
