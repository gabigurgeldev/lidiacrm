import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
// Os efeitos de negócio (opt-out, lead, despacho do agente) têm testes próprios;
// aqui interessa o que é GRAVADO como entrada.
const efeitos = vi.fn(async (_admin: unknown, _input: Record<string, unknown>) => {});
vi.mock("@/lib/channels/pos-entrada", () => ({
  aplicarEfeitosPosEntrada: (admin: unknown, input: Record<string, unknown>) => efeitos(admin, input),
}));

import { CORPO_DO_VOTO_NAO_LIDO, dispatchWahaEvent, type WahaEnvelope } from "@/lib/waha/ingest";

/**
 * A VOLTA de uma enquete/lista nossa vira mensagem de entrada comum, com o
 * RÓTULO COMPLETO no corpo e a procedência na metadata — na conversa da
 * pergunta. Se isto quebrar, o menu do fluxo espera para sempre e o agente
 * nunca sabe o que o cliente tocou, sem erro nenhum na tela.
 */

const ORG = "org-1";
const SESSION = { id: "sessao-1", organization_id: ORG };

interface Origem {
  id: string;
  contact_id: string;
  conversation_id: string;
  metadata: Record<string, unknown>;
}

function bancoDeMentira(origem: Origem | null) {
  const inseridas: Array<{ tabela: string; linha: Record<string, unknown> }> = [];
  const atualizadas: Array<{ tabela: string; patch: Record<string, unknown> }> = [];
  const filtrosDaOrigem: Array<{ metodo: string; args: unknown[] }> = [];
  const rpcs: string[] = [];

  function builder(tabela: string) {
    const st: { op: "select" | "insert" | "update"; linha?: Record<string, unknown>; patch?: Record<string, unknown> } = {
      op: "select",
    };
    const resolver = () => {
      if (st.op === "insert") {
        inseridas.push({ tabela, linha: st.linha ?? {} });
        return { data: { id: `nova-${inseridas.length}` }, error: null };
      }
      if (st.op === "update") {
        atualizadas.push({ tabela, patch: st.patch ?? {} });
        return { data: null, error: null };
      }
      if (tabela === "messages") return { data: origem, error: null };
      if (tabela === "agent_inbox_items") return { data: [], error: null };
      return { data: null, error: null };
    };
    const b: Record<string, unknown> = new Proxy(
      {},
      {
        get(_alvo, chave: string) {
          if (chave === "then") {
            return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
              Promise.resolve(resolver()).then(res, rej);
          }
          if (chave === "insert") return (linha: Record<string, unknown>) => ((st.op = "insert"), (st.linha = linha), b);
          if (chave === "update") return (patch: Record<string, unknown>) => ((st.op = "update"), (st.patch = patch), b);
          if (chave === "maybeSingle" || chave === "single") return async () => resolver();
          return (...args: unknown[]) => {
            if (tabela === "messages" && st.op === "select") filtrosDaOrigem.push({ metodo: chave, args });
            return b;
          };
        },
      },
    );
    return b;
  }

  const admin = {
    from: (tabela: string) => builder(tabela),
    rpc: async (fn: string) => {
      rpcs.push(fn);
      if (fn === "fn_upsert_wa_contact") return { data: "contato-do-from", error: null };
      if (fn === "fn_upsert_wa_conversation") return { data: "conversa-do-from", error: null };
      return { data: null, error: null };
    },
  };
  return { admin, inseridas, atualizadas, filtrosDaOrigem, rpcs };
}

const ENQUETE: Origem = {
  id: "pergunta-1",
  contact_id: "contato-da-pergunta",
  conversation_id: "conversa-da-pergunta",
  metadata: {
    opcoes: {
      formato: "enquete",
      pergunta: "Qual setor?",
      opcoes: [
        { id: "o1", label: "Suporte técnico" },
        { id: "o2", label: "Financeiro" },
      ],
    },
  },
};

function voto(selecionadas: string[], extra: Record<string, unknown> = {}): WahaEnvelope {
  return {
    event: "poll.vote",
    session: "default",
    payload: {
      vote: {
        id: "false_5531999998888@c.us_VOTO1",
        from: "5531999998888@c.us",
        to: "5531000000000@c.us",
        fromMe: false,
        selectedOptions: selecionadas,
        timestamp: 1_760_000_000,
        ...extra,
      },
      poll: { id: "true_5531999998888@c.us_3EB0POLL", fromMe: true },
    },
  } as unknown as WahaEnvelope;
}

afterEach(() => efeitos.mockClear());

describe("poll.vote", () => {
  it("vira entrada `text` com o rótulo, NA conversa da pergunta", async () => {
    const db = bancoDeMentira(ENQUETE);
    await dispatchWahaEvent(db.admin as never, SESSION as never, voto(["Suporte técnico"]), "req-1");

    const entrada = db.inseridas.find((i) => i.tabela === "messages")?.linha;
    expect(entrada).toMatchObject({
      organization_id: ORG,
      conversation_id: "conversa-da-pergunta",
      contact_id: "contato-da-pergunta",
      external_id: "false_5531999998888@c.us_VOTO1",
      type: "text",
      direction: "inbound",
      body: "Suporte técnico",
      metadata: {
        resposta_interativa: {
          formato: "enquete",
          mensagem_origem_id: "pergunta-1",
          pergunta: "Qual setor?",
          opcao_id: "o1",
          opcao_label: "Suporte técnico",
        },
      },
    });
    // O contato NÃO é resolvido pelo `from` — a pergunta já diz quem é.
    expect(db.rpcs).not.toContain("fn_upsert_wa_contact");
    // Os efeitos (que acordam o fluxo e o agente) recebem o RÓTULO.
    expect(efeitos).toHaveBeenCalledTimes(1);
    expect(efeitos.mock.calls[0]?.[1]).toMatchObject({ texto: "Suporte técnico", conversationId: "conversa-da-pergunta" });
    // A pergunta guarda a escolha, para a bolha mostrar.
    const marca = db.atualizadas.find((u) => u.tabela === "messages")?.patch;
    expect(marca?.metadata).toMatchObject({ escolha: { opcao_id: "o1", opcao_label: "Suporte técnico" } });
  });

  it("procura a pergunta pelo FIM do id e só entre enquetes/listas de saída", async () => {
    const db = bancoDeMentira(ENQUETE);
    await dispatchWahaEvent(db.admin as never, SESSION as never, voto(["Financeiro"]), "req-1");
    expect(db.filtrosDaOrigem).toEqual(
      expect.arrayContaining([
        { metodo: "eq", args: ["organization_id", ORG] },
        { metodo: "in", args: ["type", ["poll", "list"]] },
        { metodo: "like", args: ["external_id", "%3EB0POLL"] },
      ]),
    );
  });

  it("voto retirado, voto do próprio número e voto em grupo não viram mensagem", async () => {
    for (const envelope of [
      voto([]),
      voto(["Financeiro"], { fromMe: true }),
      voto(["Financeiro"], { to: "120363000000000000@g.us" }),
    ]) {
      const db = bancoDeMentira(ENQUETE);
      await dispatchWahaEvent(db.admin as never, SESSION as never, envelope, "req-1");
      expect(db.inseridas.filter((i) => i.tabela === "messages")).toHaveLength(0);
    }
  });

  // Payload REAL do NOWEB com store ligado (produção, 2026-10-13). O timestamp
  // vem em milissegundos; multiplicado por 1000 no ingest, `toISOString()`
  // lançava e o voto decifrado nunca era gravado.
  it("voto real do NOWEB (timestamp em ms) grava com data válida", async () => {
    const db = bancoDeMentira(ENQUETE);
    const real = {
      event: "poll.vote",
      session: "org_x",
      payload: {
        poll: { id: "true_203040971833554@lid_3EB0POLL", to: "203040971833554@lid", from: "me", fromMe: true },
        vote: {
          id: "false_203040971833554@lid_A5519DB29076DD78340B7FE6D113A026",
          to: "me",
          from: "203040971833554@lid",
          fromMe: false,
          timestamp: 1791919719183,
          selectedOptions: ["Financeiro"],
        },
      },
    } as unknown as WahaEnvelope;
    await dispatchWahaEvent(db.admin as never, SESSION as never, real, "req-1");
    const entrada = db.inseridas.find((i) => i.tabela === "messages")?.linha;
    expect(entrada).toMatchObject({ body: "Financeiro", conversation_id: "conversa-da-pergunta" });
    expect(String(entrada?.sent_at)).toMatch(/^2026-10-13T/);
  });

  it("sem a pergunta de origem, não grava em conversa nenhuma", async () => {
    const db = bancoDeMentira(null);
    await dispatchWahaEvent(db.admin as never, SESSION as never, voto(["Financeiro"]), "req-1");
    expect(db.inseridas).toHaveLength(0);
  });
});

describe("poll.vote.failed", () => {
  it("abre aviso `escolha_nao_lida` na Central, apontando a conversa", async () => {
    const db = bancoDeMentira(ENQUETE);
    const envelope = { ...voto([]), event: "poll.vote.failed" } as WahaEnvelope;
    await dispatchWahaEvent(db.admin as never, SESSION as never, envelope, "req-1");
    const aviso = db.inseridas.find((i) => i.tabela === "agent_inbox_items")?.linha;
    expect(aviso).toMatchObject({
      organization_id: ORG,
      kind: "escolha_nao_lida",
      ref_kind: "conversation",
      ref_id: "conversa-da-pergunta",
    });
  });

  // Só o aviso na Central deixava o agente mudo: o cliente tocava e a IA
  // seguia esperando (caso Faby, 2026-10-12). A entrada marcada acorda quem
  // espera, e o enquadramento diz ao modelo para pedir a opção por escrito.
  it("grava entrada marcada na conversa da pergunta e acorda agente e fluxo", async () => {
    const db = bancoDeMentira(ENQUETE);
    const envelope = { ...voto([]), event: "poll.vote.failed" } as WahaEnvelope;
    await dispatchWahaEvent(db.admin as never, SESSION as never, envelope, "req-1");
    const entrada = db.inseridas.find((i) => i.tabela === "messages")?.linha;
    expect(entrada).toMatchObject({
      conversation_id: "conversa-da-pergunta",
      contact_id: "contato-da-pergunta",
      direction: "inbound",
      type: "text",
      body: CORPO_DO_VOTO_NAO_LIDO,
      metadata: { escolha_nao_lida: { formato: "enquete", pergunta: "Qual setor?" } },
    });
    expect(efeitos).toHaveBeenCalledTimes(1);
  });

  it("voto ilegível sem a pergunta de origem não grava nada", async () => {
    const db = bancoDeMentira(null);
    const envelope = { ...voto([]), event: "poll.vote.failed" } as WahaEnvelope;
    await dispatchWahaEvent(db.admin as never, SESSION as never, envelope, "req-1");
    expect(db.inseridas).toHaveLength(0);
  });
});

describe("seleção de lista (message.any com listResponseMessage)", () => {
  const LISTA: Origem = {
    ...ENQUETE,
    metadata: { opcoes: { ...(ENQUETE.metadata.opcoes as Record<string, unknown>), formato: "lista" } },
  };

  it("troca o título cortado pelo rótulo completo, achado pelo rowId", async () => {
    const db = bancoDeMentira(LISTA);
    await dispatchWahaEvent(
      db.admin as never,
      SESSION as never,
      {
        event: "message.any",
        session: "default",
        payload: {
          id: "false_5531999998888@c.us_SELECAO1",
          from: "5531999998888@c.us",
          fromMe: false,
          body: "",
          _data: {
            message: {
              listResponseMessage: {
                title: "Suporte téc…",
                listType: 1,
                singleSelectReply: { selectedRowId: "o1" },
                contextInfo: { stanzaId: "3EB0LISTA" },
              },
            },
          },
        },
      } as unknown as WahaEnvelope,
      "req-1",
    );
    const entrada = db.inseridas.find((i) => i.tabela === "messages")?.linha;
    expect(entrada).toMatchObject({
      type: "text",
      body: "Suporte técnico",
      metadata: { resposta_interativa: { formato: "lista", opcao_id: "o1", mensagem_origem_id: "pergunta-1" } },
    });
  });

  it("acha a seleção dentro de ephemeralMessage (conversa com mensagens temporárias)", async () => {
    const db = bancoDeMentira(LISTA);
    await dispatchWahaEvent(
      db.admin as never,
      SESSION as never,
      {
        event: "message.any",
        session: "default",
        payload: {
          id: "false_5531999998888@c.us_SELECAO2",
          from: "5531999998888@c.us",
          fromMe: false,
          body: "",
          _data: {
            message: {
              ephemeralMessage: {
                message: {
                  listResponseMessage: {
                    title: "Financ…",
                    singleSelectReply: { selectedRowId: "o2" },
                    contextInfo: { stanzaId: "3EB0LISTA" },
                  },
                },
              },
            },
          },
        },
      } as unknown as WahaEnvelope,
      "req-1",
    );
    const entrada = db.inseridas.find((i) => i.tabela === "messages")?.linha;
    expect(entrada).toMatchObject({
      body: "Financeiro",
      metadata: { resposta_interativa: { formato: "lista", opcao_id: "o2" } },
    });
  });
});
