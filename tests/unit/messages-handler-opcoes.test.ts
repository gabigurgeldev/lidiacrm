/**
 * `sendMessageHandler` com `type: "poll" | "list"`: o PEDIDO vira o que o canal
 * desenha, e a linha gravada diz o que o contato viu.
 *
 * O que este arquivo protege é a decisão ANTES do insert — o tipo da linha, o
 * corpo (pergunta numerada) e a `metadata.opcoes` que o recebimento usa para
 * traduzir o voto de volta no rótulo. Fake de Supabase no mesmo molde de
 * `messages-handler-desfechos.test.ts`, reduzido ao que o caminho toca.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import type { SendMessageInput } from "@/lib/schemas";

const ORG = "11111111-1111-4111-8111-111111111111";
const CONV = "22222222-2222-4222-8222-222222222222";
const CONTACT = "33333333-3333-4333-8333-333333333333";
const SESSION = "44444444-4444-4444-8444-444444444444";
const USER = "55555555-5555-4555-8555-555555555555";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

type Row = Record<string, unknown>;

function makeSupabase(opts: { provider?: string; isGroup?: boolean; status?: string } = {}) {
  const state: { message: Row | null } = { message: null };
  const conversation: Row = {
    id: CONV,
    organization_id: ORG,
    contact_id: CONTACT,
    channel_session_id: SESSION,
    is_group: opts.isGroup ?? false,
    group_chat_id: opts.isGroup ? "120363000000000000@g.us" : null,
    contacts: { phone_number: "+5531999998888", wa_identity: null, is_blocked: false },
    channel_sessions: {
      provider: opts.provider ?? "waha",
      waha_session_name: "default",
      status: opts.status ?? "WORKING",
      archived_at: null,
    },
  };
  const cadeiaContacts: Record<string, unknown> = {
    eq: () => cadeiaContacts,
    then: (resolve: (v: { error: null }) => unknown) => Promise.resolve({ error: null }).then(resolve),
  };
  const client = {
    from(table: string) {
      if (table === "conversations") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: conversation, error: null }) }) }),
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      if (table === "messages") {
        return {
          insert: (row: Row) => {
            state.message = { id: "msg-1", external_id: null, ...row };
            return { select: () => ({ single: async () => ({ data: { ...state.message }, error: null }) }) };
          },
          update: (patch: Row) => {
            state.message = { ...state.message, ...patch };
            return {
              eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: { ...state.message }, error: null }) }) }),
            };
          },
          // `removerEcoDoProprioEnvio` procura o eco do próprio envio.
          delete: () => {
            const c: Record<string, unknown> = {};
            c.eq = () => c;
            c.neq = () => c;
            c.in = () => c;
            c.then = (resolve: (v: { error: null }) => unknown) => Promise.resolve({ error: null }).then(resolve);
            return c;
          },
        };
      }
      if (table === "contacts") return { update: () => cadeiaContacts };
      throw new Error(`fake_supabase: tabela inesperada '${table}'`);
    },
    rpc: async () => ({ error: null }),
  };
  return { client: client as unknown as SupabaseClient, state };
}

const ctx: HandlerCtx = { organization_id: ORG, actor: { type: "user", id: USER }, requestId: "req-1" };

const OPCOES = {
  pergunta: "Qual setor?",
  opcoes: [
    { id: "o1", label: "Suporte" },
    { id: "o2", label: "Financeiro" },
  ],
};

function pedido(type: "poll" | "list"): SendMessageInput {
  return { conversation_id: CONV, type, opcoes: OPCOES } as SendMessageInput;
}

function stubWaha() {
  vi.stubEnv("WAHA_API_BASE_URL", "http://localhost:3030");
  vi.stubEnv("WAHA_API_KEY", "hash123");
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    const href = String(url);
    if (href.includes("/api/contacts/check-exists")) {
      return Promise.resolve(Response.json({ numberExists: true, chatId: "5531999998888@c.us" }));
    }
    return Promise.resolve(Response.json({ id: "true_5531999998888@c.us_3EB0AA" }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("sendMessageHandler — opções tocáveis", () => {
  it("QR + enquete: linha `poll`, corpo numerado, opções na metadata, sai por sendPoll", async () => {
    const fetchMock = stubWaha();
    const { client, state } = makeSupabase();
    const msg = await sendMessageHandler(client, ctx, pedido("poll"));

    expect(state.message).toMatchObject({
      type: "poll",
      status: "sent",
      body: "Qual setor?\n\n1️⃣ Suporte\n2️⃣ Financeiro",
      metadata: { opcoes: { formato: "enquete", ...OPCOES } },
    });
    expect(msg.type).toBe("poll");
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/api/sendPoll"))).toBe(true);
  });

  it("QR + lista em GRUPO: vira enquete (lista só sai em conversa 1:1)", async () => {
    const fetchMock = stubWaha();
    const { client, state } = makeSupabase({ isGroup: true });
    await sendMessageHandler(client, ctx, pedido("list"));

    expect(state.message).toMatchObject({ type: "poll", metadata: { opcoes: { formato: "enquete" } } });
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/api/sendList"))).toBe(false);
  });

  it("canal sem formato nativo: rebaixa para TEXTO numerado, com a procedência gravada", async () => {
    // Sessão parada: nada sai pela rede — o que se mede é a decisão gravada.
    const { client, state } = makeSupabase({ provider: "zernio", status: "STOPPED" });
    await sendMessageHandler(client, ctx, pedido("poll"));

    expect(state.message).toMatchObject({
      type: "text",
      body: "Qual setor?\n\n1️⃣ Suporte\n2️⃣ Financeiro",
      metadata: { opcoes_em_texto: { pedido: "enquete", ...OPCOES } },
    });
    expect((state.message?.metadata as Row).opcoes).toBeUndefined();
  });
});
