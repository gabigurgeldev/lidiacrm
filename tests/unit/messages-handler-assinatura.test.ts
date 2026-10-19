/**
 * `sendMessageHandler` com `assinarComo`: o nome do atendente vai em cima do
 * texto, e o que fica GRAVADO é exatamente o que sai para o canal.
 *
 * A igualdade gravado = enviado não é estética: o dedup de eco do Stevo casa
 * por `body`. Por isso o caso de texto confere os dois lados — a linha e o
 * payload do `/api/sendText`. Fake de Supabase no molde de
 * `messages-handler-opcoes.test.ts`.
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

function makeSupabase(opts: { status?: string } = {}) {
  const state: { message: Row | null } = { message: null };
  const conversation: Row = {
    id: CONV,
    organization_id: ORG,
    contact_id: CONTACT,
    channel_session_id: SESSION,
    is_group: false,
    group_chat_id: null,
    contacts: { phone_number: "+5531999998888", wa_identity: null, is_blocked: false },
    channel_sessions: {
      provider: "waha",
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

function textoEnviado(fetchMock: ReturnType<typeof vi.fn>): string | undefined {
  const chamada = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/api/sendText"));
  if (!chamada) return undefined;
  const init = chamada[1] as RequestInit | undefined;
  return (JSON.parse(String(init?.body)) as { text?: string }).text;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("sendMessageHandler — assinatura do atendente", () => {
  it("texto sai assinado, e o gravado é igual ao enviado", async () => {
    const fetchMock = stubWaha();
    const { client, state } = makeSupabase();
    await sendMessageHandler(
      client,
      ctx,
      { conversation_id: CONV, type: "text", body: "Seu pedido saiu." } as SendMessageInput,
      { assinarComo: "Maria" },
    );

    expect(state.message).toMatchObject({
      body: "*Maria:*\nSeu pedido saiu.",
      metadata: { assinado_por: "Maria" },
    });
    expect(textoEnviado(fetchMock)).toBe("*Maria:*\nSeu pedido saiu.");
  });

  it("sem assinarComo nada muda", async () => {
    const fetchMock = stubWaha();
    const { client, state } = makeSupabase();
    await sendMessageHandler(client, ctx, {
      conversation_id: CONV,
      type: "text",
      body: "Seu pedido saiu.",
    } as SendMessageInput);

    expect(state.message?.body).toBe("Seu pedido saiu.");
    expect((state.message?.metadata as Row).assinado_por).toBeUndefined();
    expect(textoEnviado(fetchMock)).toBe("Seu pedido saiu.");
  });

  it("legenda de mídia é assinada; mídia sem legenda não ganha texto", async () => {
    // Sessão parada: nada sai pela rede — o que se mede é a linha gravada.
    const comLegenda = makeSupabase({ status: "STOPPED" });
    await sendMessageHandler(
      comLegenda.client,
      ctx,
      {
        conversation_id: CONV,
        type: "image",
        body: "Olha a foto",
        media_storage_path: `${ORG}/${CONV}/foto.jpg`,
        media_mime: "image/jpeg",
      } as SendMessageInput,
      { assinarComo: "Maria" },
    );
    expect(comLegenda.state.message?.body).toBe("*Maria:*\nOlha a foto");

    const semLegenda = makeSupabase({ status: "STOPPED" });
    await sendMessageHandler(
      semLegenda.client,
      ctx,
      {
        conversation_id: CONV,
        type: "image",
        media_storage_path: `${ORG}/${CONV}/foto.jpg`,
        media_mime: "image/jpeg",
      } as SendMessageInput,
      { assinarComo: "Maria" },
    );
    expect(semLegenda.state.message?.body ?? null).toBeNull();
  });

  it("enquete rebaixada para texto não é assinada — ninguém a digitou", async () => {
    const { client, state } = makeSupabase({ status: "STOPPED" });
    await sendMessageHandler(
      client,
      ctx,
      {
        conversation_id: CONV,
        type: "poll",
        opcoes: { pergunta: "Qual setor?", opcoes: [{ id: "o1", label: "Suporte" }, { id: "o2", label: "Financeiro" }] },
      } as SendMessageInput,
      { assinarComo: "Maria" },
    );
    expect(String(state.message?.body)).not.toContain("Maria");
  });

  it("texto que com a assinatura passa do limite é recusado com mensagem clara", async () => {
    const { client } = makeSupabase({ status: "STOPPED" });
    await expect(
      sendMessageHandler(
        client,
        ctx,
        { conversation_id: CONV, type: "text", body: "x".repeat(4090) } as SendMessageInput,
        { assinarComo: "Maria" },
      ),
    ).rejects.toMatchObject({ status: 422 });
  });
});
