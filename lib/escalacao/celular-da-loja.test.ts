import { beforeEach, describe, expect, it, vi } from "vitest";

const audit = vi.fn();
vi.mock("@/lib/audit", () => ({ audit: (...a: unknown[]) => audit(...a) }));
const registrar = vi.fn();
vi.mock("@/lib/inbox/atividade-de-comando", () => ({
  registrarTrocaDeComando: (...a: unknown[]) => registrar(...a),
}));
const devolver = vi.fn();
vi.mock("./retomada", () => ({
  devolverAtendimentoAoAgente: (...a: unknown[]) => devolver(...a),
}));

import {
  COMANDOS_DE_DEVOLUCAO,
  JANELA_DO_ECO_MS,
  devolverAutomaticoPeloCelular,
  ehComandoDeDevolucao,
  pausarAutomaticoPeloCelular,
} from "./celular-da-loja";

/**
 * Duplo de admin que REGISTRA os filtros de cada consulta. As duas perguntas que
 * a pausa faz ao banco são decisões de produto, não detalhe de implementação:
 *
 *   1. "há envio do CRM sem id, recente, nesta conversa?" — se sim, o webhook
 *      pode ser o ECO da própria IA, e pausar faria o agente se calar sozinho;
 *   2. "a conversa já está pausada?" — se sim, reescrever o motivo apagaria o
 *      motivo verdadeiro (uma passagem para humano, por exemplo).
 */
interface Chamada {
  tabela: string;
  op: string;
  filtros: Array<[string, ...unknown[]]>;
  patch?: Record<string, unknown>;
}

function admin(opts: { envioEmVoo?: boolean; jaPausada?: boolean; erroNaChecagem?: boolean } = {}) {
  const chamadas: Chamada[] = [];
  const consulta = (c: Chamada) => {
    const q: Record<string, unknown> = {};
    for (const f of ["eq", "is", "in", "neq", "gte", "or", "not", "limit", "select"]) {
      q[f] = (...args: unknown[]) => {
        c.filtros.push([f, ...args]);
        return q;
      };
    }
    q.maybeSingle = async () => {
      if (c.tabela === "messages") {
        if (opts.erroNaChecagem) return { data: null, error: { message: "boom" } };
        return { data: opts.envioEmVoo ? { id: "m1" } : null, error: null };
      }
      return { data: opts.jaPausada ? null : { id: "conversa-1" }, error: null };
    };
    return q;
  };
  const client = {
    from: (tabela: string) => ({
      select: (...a: unknown[]) => {
        const c: Chamada = { tabela, op: "select", filtros: [["select", ...a]] };
        chamadas.push(c);
        return consulta(c);
      },
      update: (patch: Record<string, unknown>) => {
        const c: Chamada = { tabela, op: "update", filtros: [], patch };
        chamadas.push(c);
        return consulta(c);
      },
    }),
  };
  return { client: client as never, chamadas };
}

const CONVERSA = {
  organizationId: "org-1",
  conversationId: "conversa-1",
  contactId: "contato-1",
  channelSessionId: "sessao-1",
  requestId: "req-1",
};

beforeEach(() => {
  audit.mockClear();
  registrar.mockClear();
  devolver.mockReset();
});

describe("pausarAutomaticoPeloCelular", () => {
  it("pausa com o silêncio durável, sem tocar no contato, e deixa rastro na tela", async () => {
    const { client, chamadas } = admin();

    const r = await pausarAutomaticoPeloCelular(client, CONVERSA);

    expect(r).toBe("pausou");
    const upd = chamadas.find((c) => c.op === "update")!;
    expect(upd.tabela).toBe("conversations");
    expect(upd.patch!.bot_silenced_until).toBe("infinity");
    expect(chamadas.some((c) => c.tabela === "contacts"), "pausar UMA conversa não é bloquear o cliente").toBe(false);
    expect(upd.filtros).toContainEqual(["eq", "organization_id", "org-1"]);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "conversation.ai_paused" }));
    // A linha do tempo ensina a volta: sem isso, quem olha a tela não sabe do `#ia`.
    expect(registrar.mock.calls[0]![0].motivo).toContain("#ia");
  });

  it("ECO PROVÁVEL: envio do CRM ainda sem id nesta conversa → não pausa", async () => {
    const { client, chamadas } = admin({ envioEmVoo: true });

    const r = await pausarAutomaticoPeloCelular(client, CONVERSA);

    expect(r).toBe("eco_provavel");
    expect(chamadas.some((c) => c.op === "update"), "a IA se calaria com a própria resposta").toBe(false);
  });

  it("a checagem do eco olha só envio do CRM, recente, sem id, nesta conversa e org", async () => {
    const agora = new Date("2026-10-15T12:00:00Z");
    const { client, chamadas } = admin();

    await pausarAutomaticoPeloCelular(client, CONVERSA, agora);

    const f = chamadas.find((c) => c.tabela === "messages")!.filtros;
    expect(f).toContainEqual(["eq", "organization_id", "org-1"]);
    expect(f).toContainEqual(["eq", "conversation_id", "conversa-1"]);
    expect(f).toContainEqual(["is", "external_id", null]);
    expect(f).toContainEqual(["in", "status", ["queued", "sending"]]);
    // Sem este filtro, a mensagem do celular que acabou de ser gravada (que é
    // `external_device`) nunca casaria — mas uma ANTERIOR presa casaria, e a
    // pausa nunca aconteceria naquela conversa.
    expect(f).toContainEqual(["neq", "sent_via", "external_device"]);
    expect(f).toContainEqual([
      "gte",
      "created_at",
      new Date(agora.getTime() - JANELA_DO_ECO_MS).toISOString(),
    ]);
  });

  it("checagem do eco falhou → não pausa (na dúvida, a IA não se cala)", async () => {
    const { client, chamadas } = admin({ erroNaChecagem: true });

    expect(await pausarAutomaticoPeloCelular(client, CONVERSA)).toBe("falhou");
    expect(chamadas.some((c) => c.op === "update")).toBe(false);
  });

  it("já pausada → não reescreve o motivo nem audita de novo", async () => {
    const { client, chamadas } = admin({ jaPausada: true });

    const r = await pausarAutomaticoPeloCelular(client, CONVERSA);

    expect(r).toBe("ja_pausada");
    const upd = chamadas.find((c) => c.op === "update")!;
    expect(upd.filtros).toContainEqual(["or", "bot_silenced_until.is.null,bot_silenced_until.neq.infinity"]);
    expect(audit).not.toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
  });
});

describe("devolverAutomaticoPeloCelular", () => {
  it("passa pela MESMA regra do botão da tela, com ator do aparelho", async () => {
    devolver.mockResolvedValue({ ok: true });
    const { client } = admin();

    await devolverAutomaticoPeloCelular(client, CONVERSA);

    expect(devolver).toHaveBeenCalledTimes(1);
    const [deps, input] = devolver.mock.calls[0]!;
    expect(deps.organizationId).toBe("org-1");
    expect(deps.actor).toEqual({ type: "webhook_source", id: "celular:sessao-1" });
    expect(input).toEqual({ conversationId: "conversa-1" });
  });
});

describe("ehComandoDeDevolucao", () => {
  it.each(["#ia", "#IA", "  #ia  ", "#bot", "#robô", "#Automático"])("%j é comando", (t) => {
    expect(ehComandoDeDevolucao(t)).toBe(true);
  });

  it.each(["ia", "#ia por favor", "a #ia respondeu", "", null, undefined, "#iaa"])("%j não é comando", (t) => {
    expect(ehComandoDeDevolucao(t)).toBe(false);
  });

  it("o primeiro comando é o que a tela ensina", () => {
    expect(COMANDOS_DE_DEVOLUCAO[0]).toBe("#ia");
  });
});
