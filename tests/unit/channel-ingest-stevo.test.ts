/**
 * A INGESTÃO DO INTERMEDIÁRIO DE CONTA — a metade que faz o canal existir.
 *
 * ## Por que a ingestão é onde os canais morrem
 *
 * Sem ela o canal é um megafone: o cliente responde e nada chega, nenhum lead se
 * move, o agente não acorda, e a janela de 24h — que deriva de
 * `conversations.last_inbound_at` — nunca abre.
 *
 * ## As asserções que carregam o arquivo
 *
 * 1. **`aplicarEfeitosPosEntrada` é chamado.** O canal oficial nasceu sem ele, e
 *    o resultado medido foi 806 despachos de agente no canal por QR contra ZERO
 *    no oficial: mensagens gravadas, inbox mostrando, e o robô mudo. É o defeito
 *    mais silencioso do repo.
 * 2. **O eco do celular do operador entra como `outbound`.** Marcá-lo como
 *    entrada faria o agente responder à própria empresa, e a janela de 24h abrir
 *    sozinha sem o cliente ter escrito — e aí os efeitos NÃO rodam, porque
 *    opt-out e demanda reagem à fala do cliente, não à nossa.
 * 3. **Reentrega não duplica**, inclusive quando o payload não traz id — caso
 *    que os canais irmãos não têm, porque neles o id é garantido pelo contrato.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/channels/pos-entrada", () => ({ aplicarEfeitosPosEntrada: vi.fn() }));
vi.mock("@/lib/channels/contato-por-telefone", () => ({
  encontrarContatoPorTelefone: vi.fn(async () => null),
}));

import { ingestStevoInbound } from "@/lib/channels/stevo/ingest";
import { aplicarEfeitosPosEntrada } from "@/lib/channels/pos-entrada";

const ORG = "11111111-1111-4111-8111-111111111111";
const SESSAO = "22222222-2222-4222-8222-222222222222";

interface Opcoes {
  /** Erro a devolver no INSERT de `messages` (ex.: 23505 de reentrega). */
  erroNoInsert?: { code: string; message: string } | null;
  /** Linhas de `messages` que já existem — para o caminho sem id. */
  mensagens?: Array<Record<string, unknown>>;
}

function makeDb(opts: Opcoes = {}) {
  const inserts: Array<Record<string, unknown>> = [];
  const rpcs: Array<{ nome: string; args: Record<string, unknown> }> = [];

  class Select implements PromiseLike<unknown> {
    private filtros: Array<[string, unknown]> = [];
    select(): this {
      return this;
    }
    eq(c: string, v: unknown): this {
      this.filtros.push([c, v]);
      return this;
    }
    gte(): this {
      return this;
    }
    limit(): this {
      return this;
    }
    then<R1 = unknown, R2 = never>(
      onOk?: ((v: { data: unknown; error: unknown }) => R1 | PromiseLike<R1>) | null,
    ): PromiseLike<R1> {
      const casam = (opts.mensagens ?? []).filter((m) =>
        this.filtros.every(([c, v]) => (m[c] ?? null) === v),
      );
      return Promise.resolve({ data: casam, error: null }).then(onOk!);
    }
  }

  class Insert implements PromiseLike<unknown> {
    constructor(private readonly patch: Record<string, unknown>) {}
    select(): this {
      return this;
    }
    maybeSingle(): this {
      return this;
    }
    then<R1 = unknown>(
      onOk?: ((v: { data: unknown; error: unknown }) => R1 | PromiseLike<R1>) | null,
    ): PromiseLike<R1> {
      if (opts.erroNoInsert) {
        return Promise.resolve({ data: null, error: opts.erroNoInsert }).then(onOk!);
      }
      inserts.push(this.patch);
      return Promise.resolve({ data: { id: "msg-1" }, error: null }).then(onOk!);
    }
  }

  const client = {
    from: () => ({
      select: () => new Select(),
      insert: (patch: Record<string, unknown>) => new Insert(patch),
    }),
    rpc: async (nome: string, args: Record<string, unknown>) => {
      rpcs.push({ nome, args });
      if (nome === "fn_upsert_wa_contact") return { data: "contato-1", error: null };
      if (nome === "fn_upsert_wa_conversation") return { data: "conversa-1", error: null };
      return { data: null, error: null };
    },
  };

  return { client, inserts, rpcs };
}

const entrada = (over: Record<string, unknown> = {}) => ({
  event: "MESSAGE",
  from: "5531999998888",
  text: "oi",
  id: "EXT-1",
  timestamp: 1_767_225_600,
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("mensagem que ENTRA", () => {
  it("vira contato, conversa e linha de mensagem", async () => {
    const { client, inserts, rpcs } = makeDb();
    const r = await ingestStevoInbound(client as never, {
      organizationId: ORG,
      channelSessionId: SESSAO,
      payload: entrada(),
    });

    expect(r.status).toBe("ingested");
    expect(rpcs.map((x) => x.nome)).toEqual([
      "fn_upsert_wa_contact",
      "fn_upsert_wa_conversation",
      "fn_mark_conversation_message",
    ]);
    expect(inserts[0]).toMatchObject({
      organization_id: ORG,
      // NOT NULL na tabela. Esquecê-lo já fez, no canal oficial, o insert falhar
      // e a rota responder "recebido: 1" com nada gravado.
      channel_session_id: SESSAO,
      direction: "inbound",
      external_id: "EXT-1",
      sent_via: "external_device",
    });
  });

  it("⭐ dispara os efeitos pós-entrada — sem isso o robô fica mudo", async () => {
    const { client } = makeDb();
    await ingestStevoInbound(client as never, {
      organizationId: ORG,
      channelSessionId: SESSAO,
      payload: entrada(),
    });

    expect(aplicarEfeitosPosEntrada).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        conversationId: "conversa-1",
        channelSessionId: SESSAO,
      }),
    );
  });

  it("carimba a conversa como ENTRADA — é o que abre a janela de 24h", async () => {
    const { client, rpcs } = makeDb();
    await ingestStevoInbound(client as never, {
      organizationId: ORG,
      channelSessionId: SESSAO,
      payload: entrada(),
    });
    const marca = rpcs.find((x) => x.nome === "fn_mark_conversation_message");
    expect(marca?.args.p_direction).toBe("inbound");
  });
});

describe("o eco do celular do operador", () => {
  it("⭐ entra como SAÍDA, não como mensagem do cliente", async () => {
    const { client, inserts, rpcs } = makeDb();
    await ingestStevoInbound(client as never, {
      organizationId: ORG,
      channelSessionId: SESSAO,
      payload: entrada({ event: "SEND_MESSAGE", text: "já respondo" }),
    });

    expect(inserts[0]).toMatchObject({ direction: "outbound", status: "sent" });
    expect(rpcs.find((x) => x.nome === "fn_mark_conversation_message")?.args.p_direction).toBe(
      "outbound",
    );
  });

  it("⭐ e NÃO dispara os efeitos — eles reagem à fala do cliente", async () => {
    // Rodá-los sobre a nossa própria mensagem faria o agente responder ao
    // operador, e um "pare de me mandar" digitado pelo atendente bloquearia o
    // cliente.
    const { client } = makeDb();
    await ingestStevoInbound(client as never, {
      organizationId: ORG,
      channelSessionId: SESSAO,
      payload: entrada({ fromMe: true }),
    });
    expect(aplicarEfeitosPosEntrada).not.toHaveBeenCalled();
  });
});

describe("reentrega", () => {
  it("23505 é duplicata, não erro — o provedor reentrega o que não recebe 200", async () => {
    const { client } = makeDb({
      erroNoInsert: { code: "23505", message: "duplicate key" },
    });
    const r = await ingestStevoInbound(client as never, {
      organizationId: ORG,
      channelSessionId: SESSAO,
      payload: entrada(),
    });
    expect(r.status).toBe("duplicate");
  });

  it("⭐ payload SEM id ainda assim não duplica, por janela curta", async () => {
    // Caso que os canais irmãos não têm: aqui o formato não é documentado e o id
    // pode faltar. Sem chave de idempotência, a reentrega duplicaria a mensagem
    // no inbox do cliente.
    const { client } = makeDb({
      mensagens: [{ organization_id: ORG, conversation_id: "conversa-1", body: "oi" }],
    });
    const r = await ingestStevoInbound(client as never, {
      organizationId: ORG,
      channelSessionId: SESSAO,
      payload: { event: "MESSAGE", from: "5531999998888", text: "oi" },
    });
    expect(r.status).toBe("duplicate");
  });
});

describe("o que não interessa", () => {
  it("evento de conexão não vira mensagem", async () => {
    const { client, inserts } = makeDb();
    const r = await ingestStevoInbound(client as never, {
      organizationId: ORG,
      channelSessionId: SESSAO,
      payload: { event: "CONNECTION", status: "disconnected" },
    });
    expect(r.status).toBe("ignored");
    expect(inserts).toEqual([]);
  });
});
