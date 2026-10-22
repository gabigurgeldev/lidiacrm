import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ResultadoDaConsulta } from "@/lib/agenda/contrato";
import { REF_KIND_DO_AGENDAMENTO } from "@/lib/agenda/tipos";
import type { HandlerCtx } from "@/lib/api/handlers/types";

/**
 * MARCAR COM PROFISSIONAIS — a escrita da agenda depois da migration 0245.
 *
 * O que este arquivo prende, cada um com o defeito que ele evita:
 *
 *  1. 23505 da `fn_agenda_marcar` (corrida perdida) vira 409
 *     `agenda_horario_ocupado`, não 500 — o 500 dizia "erro interno" para o que
 *     é "alguém pegou esse horário, escolha outro";
 *  2. a QUANTIDADE de profissionais é a que o tipo pede, e a profissional
 *     desativada / não habilitada é recusada pelo nome, antes de consultar;
 *  3. sem `professional_ids`, a escrita fica com a 1ª opção LIVRE do instante —
 *     e o dono do agendamento é o `user_id` da principal;
 *  4. `conversation_id` (da org E do contato) e `created_by_agent_id` são
 *     gravados — é por eles que o lembrete sai e que a tela diz "marcado pela IA";
 *  5. o aviso na Central nasce SÓ quando quem agiu é a IA;
 *  6. reagendar pergunta à agenda IGNORANDO o próprio agendamento e cancela o
 *     lembrete do horário antigo; cancelar também cancela o lembrete.
 *
 * Onde a sonda olha: no EFEITO no dublê do banco (o que o RPC recebeu, o que
 * foi inserido/alterado), nunca na chamada de uma função espiã.
 *
 *     npx vitest run tests/unit/agenda-marcar-com-profissionais.test.ts
 */

vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  isServiceRoleConfigured: vi.fn(() => true),
}));

// O legado `owner_user_id` cria a profissional do membro pelo client ADMIN (a
// RLS de `calendar_professionals` é manager+). O dublê só precisa existir.
const ADMIN_FALSO = { admin: true };
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ADMIN_FALSO) }));

vi.mock("@/lib/agenda/consulta", async (original) => {
  const real = await original<typeof import("@/lib/agenda/consulta")>();
  return { ...real, horariosLivresDaOrg: vi.fn() };
});

vi.mock("@/lib/agenda/profissionais", async (original) => {
  const real = await original<typeof import("@/lib/agenda/profissionais")>();
  return { ...real, garantirProfissionalDoMembro: vi.fn() };
});

const { horariosLivresDaOrg } = await import("@/lib/agenda/consulta");
const { garantirProfissionalDoMembro, MembroForaDaOrganizacaoError } = await import("@/lib/agenda/profissionais");
const { audit } = await import("@/lib/audit");
const { marcarAgendamentoHandler, alterarAgendamentoHandler, cancelarAgendamentoHandler } = await import(
  "@/app/api/v1/agenda/agendamentos/_handler"
);
const { textoDoAviso } = await import("@/lib/agenda/aviso-da-marcacao");

const ORG = "aaaaaaaa-0000-4000-8000-00000000000a";
const OUTRA_ORG = "aaaaaaaa-0000-4000-8000-0000000000bb";
const USUARIO = "bbbbbbbb-0000-4000-8000-00000000000b";
const TIPO = "cccccccc-0000-4000-8000-00000000000c";
const CONTATO = "dddddddd-0000-4000-8000-00000000000d";
const OUTRO_CONTATO = "dddddddd-0000-4000-8000-0000000000ee";
const CONVERSA = "12121212-0000-4000-8000-000000000012";
const CONVERSA_ALHEIA = "12121212-0000-4000-8000-0000000000ff";
const AGENDAMENTO = "ffffffff-0000-4000-8000-00000000000f";
const ANA = "a1a1a1a1-0000-4000-8000-0000000000a1";
const BIA = "b2b2b2b2-0000-4000-8000-0000000000b2";
const CAU = "c3c3c3c3-0000-4000-8000-0000000000c3";
const AGENTE = "e5e5e5e5-0000-4000-8000-0000000000e5";
const MENSAGEM = "f6f6f6f6-0000-4000-8000-0000000000f6";

const HORARIO = "2026-09-02T13:00:00.000Z";
const OUTRO_HORARIO = "2026-09-02T13:30:00.000Z";

type Linha = Record<string, unknown>;
type Filtro = { op: "eq" | "in"; col: string; val: unknown };

/** O banco do caso — fixture E sonda. */
let tabelas: Record<string, Linha[]>;
let inseridos: Record<string, Linha[]>;
let alterados: Array<{ tabela: string; patch: Linha; filtros: Filtro[] }>;
let rpcs: Array<{ fn: string; args: Linha }>;
let respostaDoMarcar: { data: unknown; error: { code: string; message: string } | null };
let erroNoUpdate: Record<string, { code: string; message: string }>;

/** O que a coleta oferece, por instante. */
let ofertado: ResultadoDaConsulta;

function casa(l: Linha, filtros: Filtro[]): boolean {
  return filtros.every((f) =>
    f.op === "eq" ? l[f.col] === f.val : (f.val as unknown[]).includes(l[f.col]),
  );
}

function cliente(): SupabaseClient {
  return {
    from(tabela: string) {
      const filtros: Filtro[] = [];
      let modo: "select" | "update" | "delete" = "select";
      let patch: Linha = {};
      const resolver = (um: boolean) => {
        if (modo === "update") {
          const erro = erroNoUpdate[tabela];
          if (erro) return { data: null, error: erro };
          alterados.push({ tabela, patch, filtros: [...filtros] });
          const alvo = (tabelas[tabela] ?? []).filter((l) => casa(l, filtros));
          for (const l of alvo) Object.assign(l, patch);
          return { data: um ? (alvo[0] ?? null) : alvo, error: null };
        }
        const linhas = (tabelas[tabela] ?? []).filter((l) => casa(l, filtros));
        return { data: um ? (linhas[0] ?? null) : linhas, error: null };
      };
      const cadeia: Record<string, unknown> = {
        select: () => cadeia,
        eq: (col: string, val: unknown) => (filtros.push({ op: "eq", col, val }), cadeia),
        in: (col: string, val: unknown[]) => (filtros.push({ op: "in", col, val }), cadeia),
        not: () => cadeia,
        is: () => cadeia,
        order: () => cadeia,
        limit: () => cadeia,
        maybeSingle: async () => resolver(true),
        single: async () => resolver(true),
        then: (r: (v: unknown) => unknown) => r(resolver(false)),
        update: (p: Linha) => ((modo = "update"), (patch = p), cadeia),
        insert: (linha: Linha | Linha[]) => {
          for (const l of Array.isArray(linha) ? linha : [linha]) (inseridos[tabela] ??= []).push(l);
          const resposta = { data: linha, error: null };
          return {
            select: () => ({ single: async () => resposta, maybeSingle: async () => resposta }),
            then: (r: (v: unknown) => unknown) => r(resposta),
          };
        },
      };
      return cadeia;
    },
    rpc: async (fn: string, args: Linha) => {
      rpcs.push({ fn, args });
      if (fn === "fn_agenda_marcar") return respostaDoMarcar;
      return { data: null, error: null };
    },
  } as unknown as SupabaseClient;
}

const humano: HandlerCtx = { organization_id: ORG, actor: { type: "user", id: USUARIO, role: "agent" }, requestId: "r" };
const ia: HandlerCtx = {
  organization_id: ORG,
  actor: { type: "ai_agent", id: "run-1", role: "agent", agent_id: AGENTE },
  requestId: "r",
};

function slot(instante: string, opcoes: { principalId: string; apoioId: string | null }[]) {
  const inicio = new Date(instante);
  return { inicio, fim: new Date(inicio.getTime() + 30 * 60_000), opcoes };
}

function consultaCom(slots: ReturnType<typeof slot>[], necessarios: 1 | 2 = 1): ResultadoDaConsulta {
  return {
    ok: true,
    slots,
    profissionais: [
      { id: ANA, nome: "Ana", trilha: 1, userId: USUARIO, ativo: true },
      { id: BIA, nome: "Bia", trilha: 2, userId: null, ativo: true },
    ],
    profissionaisNecessarios: necessarios,
    fusoDaRegra: "America/Sao_Paulo",
    publicouHorarios: true,
    fusoSuposto: false,
    fontesDefasadas: [],
    agendaExternaNuncaLida: false,
    profissionaisComProblema: [],
  };
}

function tipo(necessarios: 1 | 2): Linha {
  return {
    id: TIPO,
    organization_id: ORG,
    name: "Consulta",
    is_active: true,
    duration_minutes: 30,
    default_owner_user_id: USUARIO,
    requires_confirmation: false,
    location_kind: "in_person",
    location_details: null,
    professionals_required: necessarios,
  };
}

/** O que a `fn_agenda_marcar` recebeu na última chamada. */
function ultimoMarcar(): { p_organization_id: string; p_compromisso: Linha; p_profissionais: string[] } {
  const chamada = rpcs.filter((c) => c.fn === "fn_agenda_marcar").at(-1);
  if (!chamada) throw new Error("a fn_agenda_marcar não foi chamada");
  return chamada.args as never;
}

function avisos(): Linha[] {
  return inseridos["agent_inbox_items"] ?? [];
}

async function erroDe(p: Promise<unknown>): Promise<{ status?: number; code?: string } | null> {
  return p.then(
    () => null,
    (e: unknown) => e as { status?: number; code?: string },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  tabelas = {
    calendar_event_types: [tipo(1)],
    contacts: [
      { id: CONTATO, organization_id: ORG, name: "Maria", display_name: null },
      { id: OUTRO_CONTATO, organization_id: ORG, name: "João", display_name: null },
    ],
    conversations: [
      { id: CONVERSA, organization_id: ORG, contact_id: CONTATO },
      { id: CONVERSA_ALHEIA, organization_id: ORG, contact_id: OUTRO_CONTATO },
    ],
    calendar_professionals: [
      { id: ANA, organization_id: ORG, name: "Ana", is_active: true, user_id: USUARIO },
      { id: BIA, organization_id: ORG, name: "Bia", is_active: true, user_id: null },
      { id: CAU, organization_id: ORG, name: "Cau", is_active: false, user_id: null },
    ],
    calendar_event_type_professionals: [],
    calendar_appointments: [
      {
        id: AGENDAMENTO,
        organization_id: ORG,
        event_type_id: TIPO,
        owner_user_id: USUARIO,
        contact_id: CONTATO,
        title: "Consulta",
        starts_at: HORARIO,
        ends_at: "2026-09-02T13:30:00.000Z",
        status: "confirmed",
        time_zone: "America/Sao_Paulo",
        reminder_sent_at: null,
        reminder_scheduled_message_id: null,
        reminder_skipped_reason: null,
      },
    ],
    calendar_appointment_professionals: [
      { organization_id: ORG, appointment_id: AGENDAMENTO, professional_id: ANA, role: "principal" },
    ],
    conversation_scheduled_messages: [],
    crm_leads: [],
  };
  inseridos = {};
  alterados = [];
  rpcs = [];
  erroNoUpdate = {};
  respostaDoMarcar = { data: AGENDAMENTO, error: null };
  ofertado = consultaCom([slot(HORARIO, [{ principalId: ANA, apoioId: null }, { principalId: BIA, apoioId: null }])]);
  vi.mocked(horariosLivresDaOrg).mockImplementation(async () => ofertado);
});

describe("a corrida perdida", () => {
  it("23505 na gravação vira 409 `agenda_horario_ocupado`, não 500", async () => {
    respostaDoMarcar = { data: null, error: { code: "23505", message: "duplicate key cap_sem_duplicata_idx" } };

    const erro = await erroDe(marcarAgendamentoHandler(cliente(), humano, { event_type_id: TIPO, starts_at: HORARIO }));

    expect(
      erro,
      "o horário tomado entre a consulta e a gravação saiu como erro interno: a tela diz 'algo deu errado' quando a verdade é 'escolha outro horário'",
    ).toMatchObject({ status: 409, code: "agenda_horario_ocupado" });
  });

  it("CONTROLE: outro erro do banco continua 500 — a tradução é do 23505, não de qualquer falha", async () => {
    respostaDoMarcar = { data: null, error: { code: "42501", message: "permission denied" } };
    const erro = await erroDe(marcarAgendamentoHandler(cliente(), humano, { event_type_id: TIPO, starts_at: HORARIO }));
    expect(erro).toMatchObject({ status: 500, code: "internal_error" });
  });
});

describe("quantas profissionais e quais", () => {
  it("tipo que pede DUAS recusa uma só, com o código de insuficiente", async () => {
    tabelas.calendar_event_types = [tipo(2)];
    const erro = await erroDe(
      marcarAgendamentoHandler(cliente(), humano, { event_type_id: TIPO, starts_at: HORARIO, professional_ids: [ANA] }),
    );
    expect(erro).toMatchObject({ status: 422, code: "agenda_profissionais_insuficientes" });
    expect(rpcs, "recusou mas gravou mesmo assim").toHaveLength(0);
  });

  it("tipo que pede UMA recusa duas", async () => {
    const erro = await erroDe(
      marcarAgendamentoHandler(cliente(), humano, {
        event_type_id: TIPO,
        starts_at: HORARIO,
        professional_ids: [ANA, BIA],
      }),
    );
    expect(erro).toMatchObject({ status: 422, code: "agenda_profissional_invalido" });
  });

  it("a mesma profissional duas vezes é recusada antes de chegar ao banco", async () => {
    tabelas.calendar_event_types = [tipo(2)];
    const erro = await erroDe(
      marcarAgendamentoHandler(cliente(), humano, {
        event_type_id: TIPO,
        starts_at: HORARIO,
        professional_ids: [ANA, ANA],
      }),
    );
    expect(erro).toMatchObject({ status: 422, code: "agenda_profissional_invalido" });
  });

  it("profissional desativada é recusada pelo NOME, não como 'horário indisponível'", async () => {
    const erro = (await erroDe(
      marcarAgendamentoHandler(cliente(), humano, { event_type_id: TIPO, starts_at: HORARIO, professional_ids: [CAU] }),
    )) as { code?: string; message?: string } | null;
    expect(erro).toMatchObject({ code: "agenda_profissional_invalido" });
    expect(erro?.message).toContain("Cau");
  });

  it("profissional que não faz o serviço é recusada quando o tipo tem habilitação", async () => {
    tabelas.calendar_event_type_professionals = [{ organization_id: ORG, event_type_id: TIPO, professional_id: ANA }];
    const erro = await erroDe(
      marcarAgendamentoHandler(cliente(), humano, { event_type_id: TIPO, starts_at: HORARIO, professional_ids: [BIA] }),
    );
    expect(erro).toMatchObject({ status: 422, code: "agenda_profissional_invalido" });
  });

  it("explícita: grava a combinação PEDIDA, na ordem (principal, apoio)", async () => {
    tabelas.calendar_event_types = [tipo(2)];
    ofertado = consultaCom(
      [slot(HORARIO, [{ principalId: ANA, apoioId: BIA }, { principalId: BIA, apoioId: ANA }])],
      2,
    );

    const r = await marcarAgendamentoHandler(cliente(), humano, {
      event_type_id: TIPO,
      starts_at: HORARIO,
      professional_ids: [BIA, ANA],
    });

    expect(ultimoMarcar().p_profissionais, "gravou a combinação errada: a apoio virou principal").toEqual([BIA, ANA]);
    // A principal (Bia) não tem login: o dono do agendamento é NULL, não o da Ana.
    expect(ultimoMarcar().p_compromisso.owner_user_id).toBeNull();
    expect(r.professional_ids).toEqual([BIA, ANA]);
  });

  it("sem escolha: fica com a 1ª opção livre do instante, e o dono é o login da principal", async () => {
    await marcarAgendamentoHandler(cliente(), humano, { event_type_id: TIPO, starts_at: HORARIO });

    expect(ultimoMarcar().p_profissionais).toEqual([ANA]);
    expect(ultimoMarcar().p_compromisso.owner_user_id).toBe(USUARIO);
    expect(ultimoMarcar().p_organization_id, "a org da gravação não veio do contexto").toBe(ORG);
  });

  it("instante sem opção que case com o pedido é 422 de horário indisponível", async () => {
    tabelas.calendar_event_types = [tipo(2)];
    ofertado = consultaCom([slot(HORARIO, [{ principalId: ANA, apoioId: BIA }])], 2);
    const erro = await erroDe(
      marcarAgendamentoHandler(cliente(), humano, {
        event_type_id: TIPO,
        starts_at: HORARIO,
        professional_ids: [BIA, ANA],
      }),
    );
    expect(erro).toMatchObject({ status: 422, code: "agenda_horario_indisponivel" });
  });

  it("legado `owner_user_id` de quem não é membro é 422, não 500", async () => {
    vi.mocked(garantirProfissionalDoMembro).mockRejectedValueOnce(new MembroForaDaOrganizacaoError(USUARIO));
    const erro = await erroDe(
      marcarAgendamentoHandler(cliente(), humano, { event_type_id: TIPO, starts_at: HORARIO, owner_user_id: USUARIO }),
    );
    expect(erro).toMatchObject({ status: 422, code: "agenda_profissional_invalido" });
  });

  it("legado `owner_user_id` vira a profissional do membro, e é ela que a consulta pergunta", async () => {
    vi.mocked(garantirProfissionalDoMembro).mockResolvedValueOnce(ANA);
    await marcarAgendamentoHandler(cliente(), humano, { event_type_id: TIPO, starts_at: HORARIO, owner_user_id: USUARIO });
    expect(vi.mocked(horariosLivresDaOrg).mock.calls.at(-1)?.[2]).toMatchObject({ profissionalIds: [ANA] });
    expect(ultimoMarcar().p_profissionais).toEqual([ANA]);
    expect(
      vi.mocked(garantirProfissionalDoMembro).mock.calls.at(-1)?.[0],
      "criou a profissional do membro com o client de sessão: com papel agent a RLS recusa e a marcação vira 500",
    ).toBe(ADMIN_FALSO);
    expect(vi.mocked(garantirProfissionalDoMembro).mock.calls.at(-1)?.[1]).toBe(ORG);
  });
});

describe("de onde a marcação veio", () => {
  it("grava `conversation_id` e `created_by_agent_id` (o agente, não o run)", async () => {
    await marcarAgendamentoHandler(cliente(), ia, {
      event_type_id: TIPO,
      starts_at: HORARIO,
      contact_id: CONTATO,
      conversation_id: CONVERSA,
    });
    const c = ultimoMarcar().p_compromisso;
    expect(c.conversation_id, "sem a conversa, o lembrete não sabe por onde sair").toBe(CONVERSA);
    expect(c.created_by_agent_id, "gravou o id do RUN numa coluna com FK para ai_agents").toBe(AGENTE);
    expect(c.created_by_kind).toBe("ai");
    expect(c.source).toBe("mcp");
  });

  it("conversa de OUTRO contato é 404 — o lembrete iria para a pessoa errada", async () => {
    const erro = await erroDe(
      marcarAgendamentoHandler(cliente(), ia, {
        event_type_id: TIPO,
        starts_at: HORARIO,
        contact_id: CONTATO,
        conversation_id: CONVERSA_ALHEIA,
      }),
    );
    expect(erro).toMatchObject({ status: 404, code: "not_found" });
    expect(rpcs).toHaveLength(0);
  });

  it("conversa de OUTRA organização é 404", async () => {
    tabelas.conversations!.push({ id: "99999999-0000-4000-8000-000000000999", organization_id: OUTRA_ORG, contact_id: CONTATO });
    const erro = await erroDe(
      marcarAgendamentoHandler(cliente(), ia, {
        event_type_id: TIPO,
        starts_at: HORARIO,
        conversation_id: "99999999-0000-4000-8000-000000000999",
      }),
    );
    expect(erro).toMatchObject({ status: 404 });
  });

  it("sem contato no corpo, a conversa define quem é atendido", async () => {
    await marcarAgendamentoHandler(cliente(), ia, { event_type_id: TIPO, starts_at: HORARIO, conversation_id: CONVERSA });
    expect(ultimoMarcar().p_compromisso.contact_id).toBe(CONTATO);
  });
});

describe("o aviso na Central", () => {
  it("a IA marcou: nasce UM aviso apontando para o agendamento", async () => {
    await marcarAgendamentoHandler(cliente(), ia, { event_type_id: TIPO, starts_at: HORARIO, contact_id: CONTATO });

    expect(avisos(), "a IA marcou e a equipe não ficou sabendo").toHaveLength(1);
    expect(avisos()[0]).toMatchObject({
      organization_id: ORG,
      kind: "other",
      severity: "info",
      ref_kind: REF_KIND_DO_AGENDAMENTO,
      ref_id: AGENDAMENTO,
    });
  });

  it("CONTROLE: humano marcou pela tela — nenhum aviso", async () => {
    await marcarAgendamentoHandler(cliente(), humano, { event_type_id: TIPO, starts_at: HORARIO, contact_id: CONTATO });
    expect(rpcs.filter((c) => c.fn === "fn_agenda_marcar"), "o caso não chegou a marcar").toHaveLength(1);
    expect(avisos(), "aviso para o que a própria pessoa fez ensina a equipe a ignorar a Central").toHaveLength(0);
  });

  it("a IA cancelou: aviso com o motivo", async () => {
    await cancelarAgendamentoHandler(cliente(), ia, { id: AGENDAMENTO, reason: "cliente viajou" });
    expect(avisos()).toHaveLength(1);
    expect(String(avisos()[0]!.body)).toContain("cliente viajou");
  });
});

describe("reagendar", () => {
  it("pergunta à agenda IGNORANDO o próprio agendamento, pelas mesmas profissionais", async () => {
    ofertado = consultaCom([slot(OUTRO_HORARIO, [{ principalId: ANA, apoioId: null }])]);

    await alterarAgendamentoHandler(cliente(), humano, { id: AGENDAMENTO, starts_at: OUTRO_HORARIO });

    const params = vi.mocked(horariosLivresDaOrg).mock.calls.at(-1)?.[2];
    expect(
      params?.ignorarAgendamentoId,
      "mover a consulta 30 min colide com o horário antigo dela mesma, e a remarcação é recusada",
    ).toBe(AGENDAMENTO);
    expect(params?.profissionalIds).toEqual([ANA]);
  });

  it("23505 ao mover (o trigger choca a profissional) vira 409", async () => {
    ofertado = consultaCom([slot(OUTRO_HORARIO, [{ principalId: ANA, apoioId: null }])]);
    erroNoUpdate.calendar_appointments = { code: "23505", message: "cap_sem_duplicata_idx" };

    const erro = await erroDe(alterarAgendamentoHandler(cliente(), humano, { id: AGENDAMENTO, starts_at: OUTRO_HORARIO }));
    expect(erro).toMatchObject({ status: 409, code: "agenda_horario_ocupado" });
  });

  it("cancela o lembrete do horário antigo e zera as marcas para o novo poder sair", async () => {
    ofertado = consultaCom([slot(OUTRO_HORARIO, [{ principalId: ANA, apoioId: null }])]);
    Object.assign(tabelas.calendar_appointments![0]!, {
      reminder_sent_at: "2026-09-01T13:00:00.000Z",
      reminder_scheduled_message_id: MENSAGEM,
    });
    tabelas.conversation_scheduled_messages = [{ id: MENSAGEM, organization_id: ORG, status: "scheduled" }];

    await alterarAgendamentoHandler(cliente(), humano, { id: AGENDAMENTO, starts_at: OUTRO_HORARIO });

    expect(
      tabelas.conversation_scheduled_messages[0]!.status,
      "o lembrete do horário antigo continua na fila: a cliente recebe a hora errada",
    ).toBe("cancelled");
    expect(
      tabelas.calendar_appointments![0]!.reminder_sent_at,
      "a marca do lembrete antigo ficou: o cron acha que já lembrou e o horário novo nunca é lembrado",
    ).toBeNull();
    expect(tabelas.calendar_appointments![0]!.reminder_scheduled_message_id).toBeNull();
  });

  it("CONTROLE: só mexer na observação NÃO toca no lembrete", async () => {
    tabelas.calendar_appointments![0]!.reminder_scheduled_message_id = MENSAGEM;
    tabelas.conversation_scheduled_messages = [{ id: MENSAGEM, organization_id: ORG, status: "scheduled" }];

    await alterarAgendamentoHandler(cliente(), humano, { id: AGENDAMENTO, notes: "trazer exames" });

    expect(tabelas.conversation_scheduled_messages[0]!.status).toBe("scheduled");
  });

  it("a IA remarcou: aviso na Central", async () => {
    ofertado = consultaCom([slot(OUTRO_HORARIO, [{ principalId: ANA, apoioId: null }])]);
    await alterarAgendamentoHandler(cliente(), ia, { id: AGENDAMENTO, starts_at: OUTRO_HORARIO });
    expect(avisos()).toHaveLength(1);
    expect(avisos()[0]).toMatchObject({ ref_id: AGENDAMENTO, ref_kind: REF_KIND_DO_AGENDAMENTO });
  });
});

describe("cancelar", () => {
  it("o lembrete que ainda está na fila é cancelado — mensagem já enviada não é tocada", async () => {
    tabelas.calendar_appointments![0]!.reminder_scheduled_message_id = MENSAGEM;
    tabelas.conversation_scheduled_messages = [{ id: MENSAGEM, organization_id: ORG, status: "scheduled" }];

    await cancelarAgendamentoHandler(cliente(), humano, { id: AGENDAMENTO, reason: "desistiu" });

    expect(tabelas.conversation_scheduled_messages[0]!.status, "lembrete de consulta cancelada saiu").toBe("cancelled");
    const naFila = alterados.find((a) => a.tabela === "conversation_scheduled_messages");
    expect(
      naFila?.filtros,
      "o cancelamento não filtrou por status `scheduled`: mexeria em mensagem `sent` e mentiria sobre o que aconteceu",
    ).toContainEqual({ op: "eq", col: "status", val: "scheduled" });
    expect(naFila?.filtros).toContainEqual({ op: "eq", col: "organization_id", val: ORG });
  });
});

describe("audit", () => {
  it("marcar audita com as profissionais gravadas", async () => {
    await marcarAgendamentoHandler(cliente(), humano, { event_type_id: TIPO, starts_at: HORARIO });
    expect(vi.mocked(audit)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "agenda.appointment_created",
        organizationId: ORG,
        metadata: expect.objectContaining({ professional_ids: [ANA] }),
      }),
    );
  });
});

describe("o texto do aviso", () => {
  it("data ABSOLUTA no fuso do agendamento, nunca 'amanhã'", () => {
    const { titulo, corpo } = textoDoAviso({
      acao: "marcou",
      servico: "Limpeza de pele",
      cliente: "Maria",
      iniciaEm: new Date("2026-09-02T13:00:00.000Z"),
      fuso: "America/Sao_Paulo",
      profissionais: ["Ana", "Bia"],
    });
    expect(titulo).toBe("A IA marcou Limpeza de pele — Maria");
    // 13:00 UTC = 10:00 em São Paulo.
    expect(corpo).toContain("02/09/2026 às 10:00");
    expect(corpo).toContain("Com Ana e Bia.");
  });

  it("remarcar diz de onde e para onde", () => {
    const { corpo } = textoDoAviso({
      acao: "remarcou",
      servico: "Consulta",
      cliente: "Maria",
      iniciaEm: new Date("2026-09-02T14:00:00.000Z"),
      iniciavaEm: new Date("2026-09-02T13:00:00.000Z"),
      fuso: "America/Sao_Paulo",
      profissionais: [],
    });
    expect(corpo).toContain("De 02/09/2026 às 10:00 para 02/09/2026 às 11:00");
  });
});
