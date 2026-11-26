/**
 * O CLIENTE QUE VOLTA É DISTRIBUÍDO, E QUEM RECEBE É AVISADO.
 *
 * ## O incidente (Faby Flores, 2026-11-26)
 *
 * Um dia depois de o rodízio voltar a funcionar, a empresa seguia dizendo que
 * as conversas "não estavam sendo distribuídas". Medido em produção:
 *
 * 1. **183 conversas abertas sem dono.** O pedido de distribuição nasce de um
 *    trigger AFTER INSERT — só conversa NOVA entra na fila. A conversa é uma
 *    por contato, e o cliente que volta escreve na mesma linha: se ela estava
 *    sem dono, ninguém a punha na fila, e no modo "só as minhas" ninguém a via.
 * 2. **Aviso sem gatilho certo.** O fluxo de aviso rodava a CADA mensagem do
 *    cliente e reatribuía a conversa toda vez (6 trocas de dona em 3 minutos).
 *    O conserto é um gatilho que só dispara quando o SISTEMA distribui:
 *    `conversation.routed`, emitido pelo worker depois da atribuição.
 *
 * Banco de mentira, mesma técnica de `rodizio-nao-abandona-conversa.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Linha = Record<string, unknown>;

const banco: Record<string, Linha[]> = {};
const emitidos: Linha[] = [];

function casa(linha: Linha, [op, col, val]: [string, string, unknown]): boolean {
  if (op === "eq" || op === "is") return linha[col] === val;
  if (op === "in") return (val as unknown[]).includes(linha[col]);
  return true;
}

let proximoId = 0;

const clienteFalso = {
  from(tabela: string) {
    const filtros: Array<[string, string, unknown]> = [];
    let update: Linha | null = null;
    const executa = (): Linha[] => {
      const linhas = (banco[tabela] ?? []).filter((l) => filtros.every((f) => casa(l, f)));
      if (update) for (const l of linhas) Object.assign(l, update);
      return linhas.map((l) => ({ ...l }));
    };
    const b: Record<string, unknown> = {
      select: () => b,
      update: (v: Linha) => ((update = v), b),
      eq: (c: string, v: unknown) => (filtros.push(["eq", c, v]), b),
      is: (c: string, v: unknown) => (filtros.push(["is", c, v]), b),
      in: (c: string, v: unknown) => (filtros.push(["in", c, v]), b),
      or: () => b,
      order: () => b,
      limit: () => b,
      maybeSingle: () => Promise.resolve({ data: executa()[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) =>
        Promise.resolve({ data: executa(), error: null }).then(ok, erro),
    };
    return b;
  },
  rpc(nome: string, args: Linha) {
    if (nome === "emit_event") {
      const linha: Linha = {
        id: `ev-emitido-${++proximoId}`,
        organization_id: args.p_organization_id,
        event_type: args.p_event_type,
        entity_kind: args.p_entity_kind,
        entity_id: args.p_entity_id,
        payload: args.p_payload,
        metadata: args.p_metadata ?? {},
        status: "pending",
        attempts: 0,
        next_attempt_at: null,
        consumed_by: [],
      };
      emitidos.push(linha);
      (banco.event_log ??= []).push(linha);
      return Promise.resolve({ data: linha.id, error: null });
    }
    // fn_conversation_assign com expected=null
    const conv = banco.conversations?.find((c) => c.id === args.p_conversation_id);
    if (conv && conv.assigned_to_user_id == null) {
      conv.assigned_to_user_id = args.p_to_user_id;
      return Promise.resolve({ data: [{ id: conv.id }], error: null });
    }
    return Promise.resolve({ data: [], error: null });
  },
};

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => clienteFalso }));

const { rotearConversaAgora, pedirRoteamentoSeFicouSemDono, ROUTED_EVENT_TYPE, ROUTING_EVENT_TYPE } =
  await import("@/lib/routing/worker");

const ORG = "11111111-1111-4111-8111-111111111111";
const CONVERSA = "22222222-2222-4222-8222-222222222222";
const KELLY = "33333333-3333-4333-8333-333333333333";
const CONTATO = "44444444-4444-4444-8444-444444444444";
const CANAL = "55555555-5555-4555-8555-555555555555";

function semeia(opts: { dono?: string | null; status?: string; modo?: string; eventos?: Linha[] } = {}) {
  for (const k of Object.keys(banco)) delete banco[k];
  emitidos.length = 0;
  banco.event_log = opts.eventos ?? [];
  banco.conversations = [
    {
      id: CONVERSA,
      organization_id: ORG,
      contact_id: CONTATO,
      channel_session_id: CANAL,
      assigned_to_user_id: opts.dono ?? null,
      status: opts.status ?? "open",
    },
  ];
  banco.organizations = [
    { id: ORG, settings: { routing: { mode: opts.modo ?? "round_robin", max_retries: 5, backoff_seconds: 60 } } },
  ];
  banco.attendant_availability = [
    // Carga altíssima de propósito: não há mais teto por atendente.
    { organization_id: ORG, user_id: KELLY, is_available: true, capacity: 1, schedule: {} },
  ];
  banco.conversations.push(
    ...Array.from({ length: 40 }, (_, i) => ({
      id: `carga-${i}`,
      organization_id: ORG,
      contact_id: null,
      channel_session_id: CANAL,
      assigned_to_user_id: KELLY,
      status: "open",
    })),
  );
  banco.conversation_assignment_events = [];
  banco.crm_leads = [];
}

beforeEach(() => semeia());

describe("conversa que já existia, sem dono, recebe mensagem nova", () => {
  it("entra na fila e é distribuída — mesmo com a atendente carregando 40 conversas", async () => {
    const resumo = await rotearConversaAgora(ORG, CONVERSA);

    expect(emitidos.filter((e) => e.event_type === ROUTING_EVENT_TYPE)).toHaveLength(1);
    expect(resumo.outcomes.assigned).toBe(1);
    expect(banco.conversations?.find((c) => c.id === CONVERSA)?.assigned_to_user_id).toBe(KELLY);
  });

  it("não empilha pedido quando já há um pendente para a conversa", async () => {
    semeia({
      eventos: [
        {
          id: "ev-antigo",
          organization_id: ORG,
          event_type: ROUTING_EVENT_TYPE,
          entity_kind: "conversation",
          entity_id: CONVERSA,
          status: "pending",
          attempts: 0,
          next_attempt_at: null,
          consumed_by: [],
          metadata: {},
          payload: { conversation_id: CONVERSA, organization_id: ORG },
        },
      ],
    });
    expect(await pedirRoteamentoSeFicouSemDono(ORG, CONVERSA)).toBe(false);
  });

  it.each([
    ["já tem dono", { dono: KELLY }],
    ["está encerrada", { status: "resolved" }],
    ["a org distribui à mão", { modo: "manual" }],
  ])("não pede distribuição quando a conversa %s", async (_nome, opts) => {
    semeia(opts);
    expect(await pedirRoteamentoSeFicouSemDono(ORG, CONVERSA)).toBe(false);
    expect(emitidos).toHaveLength(0);
  });
});

describe("o sistema distribuiu ⇒ anuncia quem recebeu (gatilho de fluxo)", () => {
  it("emite conversation.routed com quem recebeu, a conversa, o contato e o número", async () => {
    await rotearConversaAgora(ORG, CONVERSA);

    const anuncio = emitidos.find((e) => e.event_type === ROUTED_EVENT_TYPE);
    expect(anuncio).toBeDefined();
    expect(anuncio?.organization_id).toBe(ORG);
    expect(anuncio?.payload).toMatchObject({
      conversation_id: CONVERSA,
      contact_id: CONTATO,
      channel_session_id: CANAL,
      assigned_to_user_id: KELLY,
    });
  });

  it("não anuncia quando não houve distribuição (conversa já tinha dono)", async () => {
    semeia({ dono: KELLY });
    await rotearConversaAgora(ORG, CONVERSA);
    expect(emitidos.find((e) => e.event_type === ROUTED_EVENT_TYPE)).toBeUndefined();
  });
});
