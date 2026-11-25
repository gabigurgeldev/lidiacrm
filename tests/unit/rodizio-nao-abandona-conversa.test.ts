/**
 * O RODÍZIO NÃO ABANDONA CONVERSA — o worker inteiro, com um banco de mentira.
 *
 * ## O incidente
 *
 * Faby Flores, 2026-11-25: 248 eventos `conversation.routing_requested` em
 * `status = 'dead'`, 214 conversas sem dono. Três causas diferentes ao longo de
 * três semanas (ninguém disponível; as duas atendentes no teto de capacidade;
 * "Sempre disponível" desligado e o cron de sinal de vida tirando as duas do
 * ar). Cada causa foi corrigida na configuração — e nenhuma correção devolveu
 * uma conversa sequer, porque o worker matava o evento depois de `max_retries`
 * e evento morto nunca é reavaliado. Com a visibilidade "só as minhas", conversa
 * sem dono não aparece para atendente nenhuma.
 *
 * ## O que este arquivo trava
 *
 * Os testes de `lib/routing/decide.test.ts` cobrem a DECISÃO. Aqui é a fiação:
 * que o worker, ao receber a decisão de seguir na fila, grava o evento de volta
 * como `pending` (e não `dead`), e que o mesmo evento é entregue quando alguém
 * volta. E a ordem do lote: conversa nova antes das retentativas, para que uma
 * fila parada numa org não atrase a conversa que acabou de chegar em outra.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Linha = Record<string, unknown>;

interface Consulta {
  tabela: string;
  op: "select" | "update";
  filtros: Array<[string, string, unknown]>;
  valores?: Linha;
  ordens: Array<[string, unknown]>;
}

const banco: Record<string, Linha[]> = {};
const consultas: Consulta[] = [];
const rpcs: Array<{ nome: string; args: Linha }> = [];

function casa(linha: Linha, [op, col, val]: [string, string, unknown]): boolean {
  if (op === "eq" || op === "is") return linha[col] === val;
  if (op === "in") return (val as unknown[]).includes(linha[col]);
  return true;
}

const clienteFalso = {
  from(tabela: string) {
    const q: Consulta = { tabela, op: "select", filtros: [], ordens: [] };
    const executa = (): Linha[] => {
      consultas.push(q);
      const linhas = (banco[tabela] ?? []).filter((l) => q.filtros.every((f) => casa(l, f)));
      if (q.op === "update") for (const l of linhas) Object.assign(l, q.valores);
      return linhas.map((l) => ({ ...l }));
    };
    const b: Record<string, unknown> = {
      select: () => b,
      update: (v: Linha) => {
        q.op = "update";
        q.valores = v;
        return b;
      },
      eq: (c: string, v: unknown) => (q.filtros.push(["eq", c, v]), b),
      is: (c: string, v: unknown) => (q.filtros.push(["is", c, v]), b),
      in: (c: string, v: unknown) => (q.filtros.push(["in", c, v]), b),
      or: () => b,
      order: (c: string, o: unknown) => (q.ordens.push([c, o]), b),
      limit: () => b,
      maybeSingle: () => Promise.resolve({ data: executa()[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) =>
        Promise.resolve({ data: executa(), error: null }).then(ok, erro),
    };
    return b;
  },
  rpc(nome: string, args: Linha) {
    rpcs.push({ nome, args });
    const conv = banco.conversations?.find((c) => c.id === args.p_conversation_id);
    if (conv && conv.assigned_to_user_id == null) {
      conv.assigned_to_user_id = args.p_to_user_id;
      return Promise.resolve({ data: [{ id: conv.id }], error: null });
    }
    return Promise.resolve({ data: [], error: null });
  },
};

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => clienteFalso }));

const { runRoutingWorker } = await import("@/lib/routing/worker");
const { ESPERA_NA_FILA_SEGUNDOS } = await import("@/lib/routing/decide");

const ORG = "11111111-1111-4111-8111-111111111111";
const CONVERSA = "22222222-2222-4222-8222-222222222222";
const ATENDENTE = "33333333-3333-4333-8333-333333333333";
const AGORA = new Date("2026-11-25T18:30:00Z");

function semeia({ attempts, atendenteDisponivel }: { attempts: number; atendenteDisponivel: boolean }) {
  for (const k of Object.keys(banco)) delete banco[k];
  banco.event_log = [
    {
      id: "ev-1",
      organization_id: ORG,
      event_type: "conversation.routing_requested",
      status: "pending",
      attempts,
      next_attempt_at: null,
      consumed_by: [],
      metadata: {},
      payload: { conversation_id: CONVERSA, organization_id: ORG },
    },
  ];
  banco.conversations = [
    {
      id: CONVERSA,
      organization_id: ORG,
      contact_id: null,
      assigned_to_user_id: null,
      status: "open",
    },
  ];
  banco.organizations = [
    { id: ORG, settings: { routing: { mode: "round_robin", max_retries: 5, backoff_seconds: 60 } } },
  ];
  banco.attendant_availability = [
    {
      organization_id: ORG,
      user_id: ATENDENTE,
      is_available: atendenteDisponivel,
      capacity: 999,
      schedule: {},
    },
  ];
  banco.conversation_assignment_events = [];
}

beforeEach(() => {
  consultas.length = 0;
  rpcs.length = 0;
});

describe("worker de rodízio — sem ninguém para receber, a conversa espera", () => {
  it("esgotadas as tentativas rápidas, o evento volta para `pending` — nunca `dead`", async () => {
    semeia({ attempts: 5, atendenteDisponivel: false });

    const resumo = await runRoutingWorker({ now: AGORA });

    expect(resumo.outcomes.requeued_na_fila).toBe(1);
    const ev = banco.event_log![0]!;
    expect(ev.status).toBe("pending");
    expect(ev.attempts).toBe(6);
    expect(ev.next_attempt_at).toBe(
      new Date(AGORA.getTime() + ESPERA_NA_FILA_SEGUNDOS * 1000).toISOString(),
    );
    expect((ev.metadata as { last_requeue?: { reason?: string } }).last_requeue?.reason).toBe("na_fila");
    expect(rpcs).toHaveLength(0);
    expect(banco.conversations![0]!.assigned_to_user_id).toBeNull();
  });

  it("dias depois, a atendente volta ⇒ o MESMO evento entrega a conversa a ela", async () => {
    semeia({ attempts: 300, atendenteDisponivel: true });

    const resumo = await runRoutingWorker({ now: AGORA });

    expect(resumo.outcomes.assigned).toBe(1);
    expect(rpcs[0]?.nome).toBe("fn_conversation_assign");
    expect(rpcs[0]?.args.p_organization_id).toBe(ORG);
    expect(banco.conversations![0]!.assigned_to_user_id).toBe(ATENDENTE);
    expect(banco.event_log![0]!.status).toBe("done");
  });

  it("conversa encerrada enquanto esperava ⇒ o evento termina sem atribuir", async () => {
    semeia({ attempts: 40, atendenteDisponivel: true });
    banco.conversations![0]!.status = "resolved";

    const resumo = await runRoutingWorker({ now: AGORA });

    expect(resumo.outcomes.skipped_not_queued).toBe(1);
    expect(rpcs).toHaveLength(0);
    expect(banco.event_log![0]!.status).toBe("done");
  });

  it("o lote põe conversa NOVA antes das retentativas", async () => {
    semeia({ attempts: 0, atendenteDisponivel: true });

    await runRoutingWorker({ now: AGORA });

    const puxada = consultas.find((c) => c.tabela === "event_log" && c.op === "select");
    expect(puxada?.ordens).toEqual([
      ["next_attempt_at", { ascending: true, nullsFirst: true }],
      ["created_at", { ascending: true }],
    ]);
  });
});
