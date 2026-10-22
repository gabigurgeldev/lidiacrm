/**
 * A COLETA POR PROFISSIONAL — o que sai do banco para o motor (migration 0245).
 *
 * O motor é puro e tem teste próprio; aqui o que se mede é a TRAVESSIA: de qual
 * tabela vem a jornada de quem tem login e de quem não tem, quais compromissos
 * ocupam quem, e em que ordem a consulta escolhe as candidatas. Erro aqui não
 * dá exceção — dá horário oferecido em cima de compromisso, ou agenda inteira
 * fora do ar por causa de uma pessoa.
 *
 * ─── O banco é um dublê EM MEMÓRIA que aplica os filtros ───────────────────
 *
 * Não é um mock que devolve o que o teste quer: as linhas moram em tabelas e
 * cada `.eq/.in/.lt/.gt` FILTRA de verdade. Um filtro esquecido no código faz a
 * linha da outra organização (semeada em todo cenário) vazar para o resultado
 * — e o caso de isolamento abaixo mede justamente isso. E toda consulta é
 * registrada, para provar que nenhuma saiu sem `organization_id` (o client pode
 * ser o ADMIN, que bypassa a RLS).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it } from "vitest";

import { horariosLivresDaOrg, listaAgendamentos } from "@/lib/agenda/consulta";
import { detalheDoAgendamento } from "@/lib/agenda/consulta-detalhe";
import { partesNoFuso } from "@/lib/agenda/fuso";
import {
  carregarAgendasDosProfissionais,
  garantirProfissionalDoMembro,
  jornadaDoProfissional,
  MembroForaDaOrganizacaoError,
  profissionaisHabilitados,
} from "@/lib/agenda/profissionais";

type Linha = Record<string, unknown>;

const ORG = "00000000-0000-4000-8000-00000000000a";
const OUTRA = "00000000-0000-4000-8000-00000000000b";
const SP = "America/Sao_Paulo";

/** O registro de cada consulta: tabela e as colunas filtradas por igualdade/lista. */
interface ConsultaFeita {
  tabela: string;
  filtros: string[];
}

class Banco {
  tabelas = new Map<string, Linha[]>();
  consultas: ConsultaFeita[] = [];
  /** Índice único simulado no insert: tabela → colunas. */
  unicos = new Map<string, string[]>();
  nomes = new Map<string, { full_name?: string; email?: string }>();
  antesDoInsert: ((tabela: string) => void) | null = null;

  linhas(t: string): Linha[] {
    if (!this.tabelas.has(t)) this.tabelas.set(t, []);
    return this.tabelas.get(t)!;
  }

  client(): SupabaseClient {
    return clientDoBanco(this);
  }
}

function clientDoBanco(banco: Banco): SupabaseClient {
  return {
    from(tabela: string) {
      return {
        select: () => new Consulta(banco, tabela),
        insert: (linha: Linha) => {
          banco.antesDoInsert?.(tabela);
          const chave = banco.unicos.get(tabela);
          const colide =
            chave && banco.linhas(tabela).some((l) => chave.every((c) => l[c] === linha[c]));
          if (colide) {
            return Promise.resolve({
              data: null,
              error: { code: "23505", message: "duplicate key" },
            });
          }
          banco
            .linhas(tabela)
            .push({
              id: `novo-${banco.linhas(tabela).length + 1}`,
              position: 1000,
              is_active: true,
              ...linha,
            });
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
    auth: {
      admin: {
        getUserById: async (id: string) => {
          const u = banco.nomes.get(id);
          return {
            data: {
              user: u ? { id, email: u.email, user_metadata: { full_name: u.full_name } } : null,
            },
            error: null,
          };
        },
      },
    },
  } as unknown as SupabaseClient;
}

class Consulta implements PromiseLike<{ data: Linha[] | null; error: null }> {
  private preds: ((l: Linha) => boolean)[] = [];
  private filtros: string[] = [];
  private ordem: { c: string; asc: boolean } | null = null;
  private teto: number | null = null;

  constructor(
    private readonly banco: Banco,
    private readonly tabela: string,
  ) {}

  private valorDe(l: Linha, coluna: string): unknown {
    return l[coluna];
  }

  eq(c: string, v: unknown): this {
    this.filtros.push(c);
    this.preds.push((l) => this.valorDe(l, c) === v);
    return this;
  }
  in(c: string, vs: unknown[]): this {
    this.filtros.push(c);
    this.preds.push((l) => vs.includes(this.valorDe(l, c)));
    return this;
  }
  lt(c: string, v: string): this {
    this.preds.push((l) => String(l[c]) < v);
    return this;
  }
  gt(c: string, v: string): this {
    this.preds.push((l) => String(l[c]) > v);
    return this;
  }
  gte(c: string, v: string): this {
    this.preds.push((l) => String(l[c]) >= v);
    return this;
  }
  lte(c: string, v: string): this {
    this.preds.push((l) => String(l[c]) <= v);
    return this;
  }
  order(c: string, o?: { ascending?: boolean }): this {
    this.ordem = { c, asc: o?.ascending !== false };
    return this;
  }
  limit(n: number): this {
    this.teto = n;
    return this;
  }

  private executar(): Linha[] {
    this.banco.consultas.push({ tabela: this.tabela, filtros: this.filtros });
    let r = this.banco.linhas(this.tabela).filter((l) => this.preds.every((p) => p(l)));
    if (this.ordem) {
      const { c, asc } = this.ordem;
      r = [...r].sort(
        (a, b) =>
          (String(a[c]) < String(b[c]) ? -1 : String(a[c]) > String(b[c]) ? 1 : 0) * (asc ? 1 : -1),
      );
    }
    if (this.teto !== null) r = r.slice(0, this.teto);
    return r;
  }

  async maybeSingle(): Promise<{ data: Linha | null; error: { message: string } | null }> {
    const r = this.executar();
    if (r.length > 1) return { data: null, error: { message: "multiple rows" } };
    return { data: r[0] ?? null, error: null };
  }

  then<R1, R2 = never>(
    ok?: ((v: { data: Linha[] | null; error: null }) => R1 | PromiseLike<R1>) | null,
    falha?: ((e: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve({ data: this.executar(), error: null }).then(ok, falha);
  }
}

// ─── cenário ────────────────────────────────────────────────────────────────

const JORNADA_SP = {
  timezone: SP,
  windows: [1, 2, 3, 4, 5].map((dow) => ({ dow, start: "09:00", end: "12:00" })),
};

/** Segunda, 09/03/2026 (GMT-3). */
const DE = new Date("2026-03-09T03:00:00Z");
const ATE = new Date("2026-03-10T02:59:00Z");
const AGORA = new Date("2026-03-01T12:00:00Z");

function sp(dataHora: string): string {
  return new Date(`${dataHora}:00-03:00`).toISOString();
}

function horas(slots: { inicio: Date }[]): string[] {
  return slots.map((s) => {
    const p = partesNoFuso(s.inicio, SP);
    return `${String(p.hora).padStart(2, "0")}:${String(p.minuto).padStart(2, "0")}`;
  });
}

let banco: Banco;
let sb: SupabaseClient;

function profissional(id: string, extra: Linha = {}): Linha {
  return {
    id,
    organization_id: ORG,
    name: id,
    trilha: null,
    user_id: null,
    is_active: true,
    schedule: null,
    position: 1000,
    ...extra,
  };
}

function tipo(extra: Linha = {}): Linha {
  return {
    id: "tipo-1",
    organization_id: ORG,
    slug: "consulta",
    name: "Consulta",
    is_active: true,
    duration_minutes: 60,
    buffer_before_minutes: 0,
    buffer_after_minutes: 0,
    minimum_notice_minutes: 0,
    slot_interval_minutes: null,
    booking_window_days: 60,
    default_owner_user_id: null,
    professionals_required: 1,
    ...extra,
  };
}

function habilitar(...ids: string[]): void {
  for (const id of ids) {
    banco
      .linhas("calendar_event_type_professionals")
      .push({ organization_id: ORG, event_type_id: "tipo-1", professional_id: id });
  }
}

beforeEach(() => {
  banco = new Banco();
  sb = banco.client();
  // A OUTRA organização, semeada em todo cenário com os MESMOS ids onde dá:
  // filtro de organização esquecido faz isto aparecer no resultado.
  banco
    .linhas("calendar_professionals")
    .push(profissional("p-intrusa", { organization_id: OUTRA, schedule: JORNADA_SP }));
  banco.linhas("calendar_appointment_professionals").push({
    organization_id: OUTRA,
    appointment_id: "ag-alheio",
    professional_id: "p-ana",
    starts_at: sp("2026-03-09T09:00"),
    ends_at: sp("2026-03-09T12:00"),
    status: "confirmed",
  });
  banco
    .linhas("attendant_availability")
    .push({ organization_id: OUTRA, user_id: "u-ana", schedule: { timezone: SP, windows: [] } });
});

function semFiltroDeOrganizacao(): ConsultaFeita[] {
  return banco.consultas.filter((c) => !c.filtros.includes("organization_id"));
}

// ─── jornada ────────────────────────────────────────────────────────────────

describe("de onde vem a jornada", () => {
  it("com login: `attendant_availability.schedule` — a mesma do roteamento", () => {
    const r = jornadaDoProfissional({ user_id: "u-1", schedule: null }, JORNADA_SP);
    expect(r.ok && r.publicouHorarios).toBe(true);
  });

  it("sem login: a `schedule` da própria linha", () => {
    const r = jornadaDoProfissional(
      { user_id: null, schedule: JORNADA_SP },
      { timezone: SP, windows: [] },
    );
    expect(
      r.ok && r.publicouHorarios,
      "leu a do membro, que nem existe para quem não tem login",
    ).toBe(true);
  });

  it("sem login e sem jornada: a recusa manda para a tela onde ELA aparece", () => {
    const r = jornadaDoProfissional({ user_id: null, schedule: null }, undefined);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivoParaOperador).toContain("Profissionais");
  });
});

// ─── coleta ─────────────────────────────────────────────────────────────────

describe("carregarAgendasDosProfissionais", () => {
  beforeEach(() => {
    banco
      .linhas("calendar_professionals")
      .push(
        profissional("p-ana", { user_id: "u-ana", name: "Ana" }),
        profissional("p-bia", { name: "Bia", schedule: JORNADA_SP }),
      );
    banco
      .linhas("attendant_availability")
      .push({ organization_id: ORG, user_id: "u-ana", schedule: JORNADA_SP });
  });

  it("cada uma lê a jornada da fonte certa, e nada sai sem `organization_id`", async () => {
    const r = await carregarAgendasDosProfissionais(sb, ORG, ["p-ana", "p-bia", "p-intrusa"], {
      de: DE,
      ate: ATE,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([...r.agendas.keys()], "a profissional da outra organização entrou na coleta").toEqual([
      "p-ana",
      "p-bia",
    ]);
    expect(r.agendas.get("p-ana")!.leitura.ok).toBe(true);
    expect(r.agendas.get("p-bia")!.leitura.ok).toBe(true);
    expect(
      semFiltroDeOrganizacao(),
      "consulta sem filtro de organização — com o ADMIN isto lê outro tenant",
    ).toEqual([]);
  });

  it("em LOTE: uma consulta por tabela, não uma por pessoa", async () => {
    await carregarAgendasDosProfissionais(sb, ORG, ["p-ana", "p-bia"], { de: DE, ate: ATE });
    const porTabela = new Map<string, number>();
    for (const c of banco.consultas) porTabela.set(c.tabela, (porTabela.get(c.tabela) ?? 0) + 1);
    for (const [tabela, n] of porTabela) expect(n, `${tabela} consultada ${n} vezes`).toBe(1);
  });

  it("ocupa por participação (principal OU apoio) E por dono legado — sem contar duas vezes", async () => {
    banco
      .linhas("calendar_appointment_professionals")
      .push(
        {
          organization_id: ORG,
          appointment_id: "ag-1",
          professional_id: "p-ana",
          role: "principal",
          starts_at: sp("2026-03-09T09:00"),
          ends_at: sp("2026-03-09T10:00"),
          status: "confirmed",
        },
        {
          organization_id: ORG,
          appointment_id: "ag-2",
          professional_id: "p-bia",
          role: "apoio",
          starts_at: sp("2026-03-09T10:00"),
          ends_at: sp("2026-03-09T11:00"),
          status: "confirmed",
        },
      );
    banco.linhas("calendar_appointments").push(
      // ag-1 de novo, pela porta do dono: tem de virar UM ocupado.
      {
        id: "ag-1",
        organization_id: ORG,
        owner_user_id: "u-ana",
        starts_at: sp("2026-03-09T09:00"),
        ends_at: sp("2026-03-09T10:00"),
        status: "confirmed",
      },
      // legado sem participante (anterior à 0245): só a porta do dono o enxerga.
      {
        id: "ag-legado",
        organization_id: ORG,
        owner_user_id: "u-ana",
        starts_at: sp("2026-03-09T11:00"),
        ends_at: sp("2026-03-09T12:00"),
        status: "confirmed",
      },
    );
    const r = await carregarAgendasDosProfissionais(sb, ORG, ["p-ana", "p-bia"], {
      de: DE,
      ate: ATE,
    });
    if (!r.ok) throw new Error(r.motivoParaOperador);
    expect(
      r.agendas.get("p-ana")!.ocupados,
      "o ag-alheio (outra org, mesmo professional_id) não pode ocupar",
    ).toHaveLength(2);
    expect(r.agendas.get("p-bia")!.ocupados, "a apoio também fica ocupada").toHaveLength(1);
  });

  it("remarcar: o próprio agendamento não ocupa (`ignorarAgendamentoId`)", async () => {
    banco.linhas("calendar_appointment_professionals").push({
      organization_id: ORG,
      appointment_id: "ag-1",
      professional_id: "p-ana",
      role: "principal",
      starts_at: sp("2026-03-09T09:00"),
      ends_at: sp("2026-03-09T10:00"),
      status: "confirmed",
    });
    banco.linhas("calendar_appointments").push({
      id: "ag-1",
      organization_id: ORG,
      owner_user_id: "u-ana",
      starts_at: sp("2026-03-09T09:00"),
      ends_at: sp("2026-03-09T10:00"),
      status: "confirmed",
    });
    const r = await carregarAgendasDosProfissionais(sb, ORG, ["p-ana"], {
      de: DE,
      ate: ATE,
      ignorarAgendamentoId: "ag-1",
    });
    if (!r.ok) throw new Error(r.motivoParaOperador);
    expect(r.agendas.get("p-ana")!.ocupados).toEqual([]);
  });

  it("exceções chegam por `professional_id` — inclusive de quem não tem login", async () => {
    banco.linhas("calendar_availability_exceptions").push({
      organization_id: ORG,
      professional_id: "p-bia",
      user_id: null,
      exception_date: "2026-03-09",
      is_unavailable: true,
      start_minute: 0,
      end_minute: 1440,
    });
    const r = await carregarAgendasDosProfissionais(sb, ORG, ["p-ana", "p-bia"], {
      de: DE,
      ate: ATE,
    });
    if (!r.ok) throw new Error(r.motivoParaOperador);
    expect(r.agendas.get("p-bia")!.excecoes).toHaveLength(1);
    expect(r.agendas.get("p-ana")!.excecoes).toEqual([]);
  });

  it("evento do Google ocupa quem é dona da conexão, por `connection_id`", async () => {
    banco
      .linhas("calendar_connections")
      .push({
        id: "con-1",
        organization_id: ORG,
        user_id: "u-ana",
        status: "healthy",
        last_sync_at: "2026-03-01T00:00:00Z",
      });
    banco.linhas("calendar_external_events").push({
      organization_id: ORG,
      connection_id: "con-1",
      starts_at: sp("2026-03-09T09:00"),
      ends_at: sp("2026-03-09T10:00"),
      transparency: "opaque",
      status: "confirmed",
    });
    const r = await carregarAgendasDosProfissionais(sb, ORG, ["p-ana", "p-bia"], {
      de: DE,
      ate: ATE,
    });
    if (!r.ok) throw new Error(r.motivoParaOperador);
    expect(r.agendas.get("p-ana")!.ocupados).toHaveLength(1);
    expect(r.agendas.get("p-bia")!.ocupados).toEqual([]);
  });
});

// ─── a consulta ─────────────────────────────────────────────────────────────

describe("horariosLivresDaOrg — quem é candidata, e em que ordem", () => {
  beforeEach(() => {
    banco.linhas("calendar_event_types").push(tipo());
    banco
      .linhas("calendar_professionals")
      .push(
        profissional("p-ana", { name: "Ana", schedule: JORNADA_SP, position: 1 }),
        profissional("p-bia", {
          name: "Bia",
          schedule: {
            timezone: SP,
            windows: [1, 2, 3, 4, 5].map((dow) => ({ dow, start: "10:00", end: "12:00" })),
          },
          position: 2,
        }),
      );
  });

  const consultar = (extra: Partial<Parameters<typeof horariosLivresDaOrg>[2]> = {}) =>
    horariosLivresDaOrg(sb, ORG, {
      eventTypeId: "tipo-1",
      de: DE,
      ate: ATE,
      agora: AGORA,
      ...extra,
    });

  it("habilitadas ativas: a união, com as opções na ordem de `position`", async () => {
    habilitar("p-bia", "p-ana");
    const r = await consultar();
    if (!r.ok) throw new Error(r.motivoParaOperador);
    expect(r.profissionais.map((p) => p.nome)).toEqual(["Ana", "Bia"]);
    expect(horas(r.slots)).toEqual(["09:00", "10:00", "11:00"]);
    expect(r.slots[1]!.opcoes.map((o) => o.principalId)).toEqual(["p-ana", "p-bia"]);
    expect(r.profissionaisNecessarios).toBe(1);
    expect(semFiltroDeOrganizacao()).toEqual([]);
  });

  it("explícita vence as habilitadas", async () => {
    habilitar("p-ana", "p-bia");
    const r = await consultar({ profissionalIds: ["p-bia"] });
    if (!r.ok) throw new Error(r.motivoParaOperador);
    expect(horas(r.slots)).toEqual(["10:00", "11:00"]);
    expect(r.slots.every((s) => s.opcoes.every((o) => o.principalId === "p-bia"))).toBe(true);
  });

  it("explícita fora da habilitação do tipo: `profissional_invalido`", async () => {
    habilitar("p-ana");
    const r = await consultar({ profissionalIds: ["p-bia"] });
    expect(r.ok === false && r.codigo).toBe("profissional_invalido");
  });

  it("explícita de OUTRA organização: `profissional_invalido`, não horário", async () => {
    const r = await consultar({ profissionalIds: ["p-intrusa"] });
    expect(r.ok === false && r.codigo).toBe("profissional_invalido");
  });

  it("legado `ownerUserId`: traduzido para o profissional do membro", async () => {
    banco
      .linhas("calendar_professionals")
      .push(profissional("p-cris", { name: "Cris", user_id: "u-cris" }));
    banco
      .linhas("attendant_availability")
      .push({ organization_id: ORG, user_id: "u-cris", schedule: JORNADA_SP });
    const r = await consultar({ ownerUserId: "u-cris" });
    if (!r.ok) throw new Error(r.motivoParaOperador);
    expect(r.profissionais.map((p) => p.id)).toEqual(["p-cris"]);
  });

  it("sem habilitação: cai para o profissional do dono padrão", async () => {
    banco.tabelas.set("calendar_event_types", [tipo({ default_owner_user_id: "u-cris" })]);
    banco
      .linhas("calendar_professionals")
      .push(profissional("p-cris", { name: "Cris", user_id: "u-cris" }));
    banco
      .linhas("attendant_availability")
      .push({ organization_id: ORG, user_id: "u-cris", schedule: JORNADA_SP });
    const r = await consultar();
    if (!r.ok) throw new Error(r.motivoParaOperador);
    expect(r.profissionais.map((p) => p.id)).toEqual(["p-cris"]);
  });

  it("sem habilitação e sem dono: `sem_responsavel` — nunca lista vazia", async () => {
    const r = await consultar();
    expect(r.ok === false && r.codigo).toBe("sem_responsavel");
  });

  it("habilitada DESATIVADA não é candidata", async () => {
    habilitar("p-ana", "p-bia");
    banco.linhas("calendar_professionals").find((p) => p.id === "p-bia")!.is_active = false;
    const r = await consultar();
    if (!r.ok) throw new Error(r.motivoParaOperador);
    expect(r.profissionais.map((p) => p.id)).toEqual(["p-ana"]);
  });

  it("jornada quebrada de UMA: é pulada e reportada, e a agenda segue no ar", async () => {
    banco
      .linhas("calendar_professionals")
      .push(profissional("p-cris", { name: "Cris", position: 3 }));
    habilitar("p-ana", "p-cris");
    const r = await consultar();
    if (!r.ok) throw new Error(r.motivoParaOperador);
    expect(r.profissionais.map((p) => p.id)).toEqual(["p-ana"]);
    expect(r.profissionaisComProblema.map((p) => p.nome)).toEqual(["Cris"]);
    expect(r.profissionaisComProblema[0]!.motivoParaOperador).toContain("Cris");
  });

  it("...mas se a quebrada foi PEDIDA, a consulta recusa — responder com outra é outra pergunta", async () => {
    banco.linhas("calendar_professionals").push(profissional("p-cris", { name: "Cris" }));
    habilitar("p-ana", "p-cris");
    const r = await consultar({ profissionalIds: ["p-cris"] });
    expect(r.ok === false && r.codigo).toBe("jornada_mal_configurada");
  });

  it("...e se TODAS estão quebradas, também recusa", async () => {
    banco.linhas("calendar_professionals").push(profissional("p-cris", { name: "Cris" }));
    habilitar("p-cris");
    const r = await consultar();
    expect(r.ok === false && r.codigo).toBe("jornada_mal_configurada");
  });

  it("tipo que pede DUAS: só os horários em que as duas estão livres", async () => {
    banco.tabelas.set("calendar_event_types", [tipo({ professionals_required: 2 })]);
    habilitar("p-ana", "p-bia");
    const r = await consultar();
    if (!r.ok) throw new Error(r.motivoParaOperador);
    expect(r.profissionaisNecessarios).toBe(2);
    expect(horas(r.slots), "09:00 a Bia ainda não chegou").toEqual(["10:00", "11:00"]);
    expect(r.slots[0]!.opcoes).toEqual([
      { principalId: "p-ana", apoioId: "p-bia" },
      { principalId: "p-bia", apoioId: "p-ana" },
    ]);
  });

  it("tipo que pede DUAS com uma só habilitada: `profissionais_insuficientes`", async () => {
    banco.tabelas.set("calendar_event_types", [tipo({ professionals_required: 2 })]);
    habilitar("p-ana");
    const r = await consultar();
    expect(r.ok === false && r.codigo).toBe("profissionais_insuficientes");
  });

  it("tipo que pede DUAS, uma pedida: ela é a principal e a apoio sai das habilitadas", async () => {
    banco.tabelas.set("calendar_event_types", [tipo({ professionals_required: 2 })]);
    habilitar("p-ana", "p-bia");
    const r = await consultar({ profissionalIds: ["p-bia"] });
    if (!r.ok) throw new Error(r.motivoParaOperador);
    expect(r.slots.flatMap((s) => s.opcoes)).toEqual([
      { principalId: "p-bia", apoioId: "p-ana" },
      { principalId: "p-bia", apoioId: "p-ana" },
    ]);
  });

  it("tipo que pede UMA e vieram duas: recusa em vez de escolher por conta própria", async () => {
    habilitar("p-ana", "p-bia");
    const r = await consultar({ profissionalIds: ["p-ana", "p-bia"] });
    expect(r.ok === false && r.codigo).toBe("profissional_invalido");
  });
});

describe("profissionaisHabilitados", () => {
  it("só as ativas desta organização, na ordem de exibição", async () => {
    banco
      .linhas("calendar_professionals")
      .push(
        profissional("p-z", { name: "Zélia", position: 1 }),
        profissional("p-a", { name: "Alice", position: 1 }),
        profissional("p-off", { name: "Off", is_active: false }),
      );
    for (const id of ["p-z", "p-a", "p-off", "p-intrusa"]) {
      banco
        .linhas("calendar_event_type_professionals")
        .push({ organization_id: ORG, event_type_id: "tipo-1", professional_id: id });
    }
    const r = await profissionaisHabilitados(sb, ORG, "tipo-1");
    expect(r.map((p) => p.nome)).toEqual(["Alice", "Zélia"]);
  });
});

describe("garantirProfissionalDoMembro", () => {
  beforeEach(() => {
    banco.unicos.set("calendar_professionals", ["organization_id", "user_id"]);
    banco
      .linhas("user_organizations")
      .push({ organization_id: ORG, user_id: "u-novo", calendar_trilha: 3, revoked_at: null });
    banco.nomes.set("u-novo", { full_name: "Dra. Nova", email: "nova@clinica.test" });
  });

  it("cria uma vez e devolve o MESMO id na segunda chamada", async () => {
    const a = await garantirProfissionalDoMembro(sb, ORG, "u-novo");
    const b = await garantirProfissionalDoMembro(sb, ORG, "u-novo");
    expect(a).toBe(b);
    const doMembro = banco.linhas("calendar_professionals").filter((p) => p.user_id === "u-novo");
    expect(doMembro).toHaveLength(1);
    expect(doMembro[0]).toMatchObject({ name: "Dra. Nova", trilha: 3, organization_id: ORG });
  });

  it("corrida perdida (23505): devolve a linha que a outra requisição criou", async () => {
    // A outra requisição cria o profissional ENTRE a leitura e o insert desta:
    // o insert colide no índice (organization_id, user_id) e a função tem de
    // ler de volta em vez de estourar ou duplicar.
    banco.antesDoInsert = (tabela) => {
      if (tabela === "calendar_professionals") {
        banco.linhas(tabela).push(profissional("p-da-outra", { user_id: "u-novo" }));
      }
    };
    const id = await garantirProfissionalDoMembro(sb, ORG, "u-novo");
    expect(id).toBe("p-da-outra");
    expect(
      banco.linhas("calendar_professionals").filter((p) => p.user_id === "u-novo"),
    ).toHaveLength(1);
  });

  it("membro revogado ou de outra organização: recusa, não cria", async () => {
    await expect(garantirProfissionalDoMembro(sb, ORG, "u-desconhecido")).rejects.toBeInstanceOf(
      MembroForaDaOrganizacaoError,
    );
    expect(banco.linhas("calendar_professionals").some((p) => p.user_id === "u-desconhecido")).toBe(
      false,
    );
  });
});

describe("listaAgendamentos e detalheDoAgendamento — os campos da 0245", () => {
  beforeEach(() => {
    banco
      .linhas("calendar_professionals")
      .push(
        profissional("p-ana", { name: "Ana", user_id: "u-ana", trilha: 2 }),
        profissional("p-bia", { name: "Bia" }),
      );
    banco.linhas("calendar_appointments").push(
      {
        id: "ag-1",
        organization_id: ORG,
        title: "Limpeza",
        starts_at: sp("2026-03-09T10:00"),
        ends_at: sp("2026-03-09T11:00"),
        time_zone: SP,
        status: "confirmed",
        owner_user_id: "u-ana",
        contact_id: "c-1",
        event_type_id: "tipo-1",
        source: "mcp",
        created_by_kind: "ai",
        conversation_id: "conv-1",
        contacts: { name: "Maria", display_name: null },
        notes: null,
        cancellation_reason: null,
        reminder_sent_at: null,
        reminder_skipped_reason: null,
        reminder_scheduled_message_id: null,
      },
      {
        id: "ag-2",
        organization_id: ORG,
        title: "Outra",
        starts_at: sp("2026-03-09T14:00"),
        ends_at: sp("2026-03-09T15:00"),
        time_zone: SP,
        status: "confirmed",
        owner_user_id: null,
        contact_id: null,
        event_type_id: null,
        source: "ui",
        created_by_kind: "user",
        conversation_id: null,
        contacts: null,
      },
    );
    banco
      .linhas("calendar_appointment_professionals")
      .push(
        { organization_id: ORG, appointment_id: "ag-1", professional_id: "p-bia", role: "apoio" },
        {
          organization_id: ORG,
          appointment_id: "ag-1",
          professional_id: "p-ana",
          role: "principal",
        },
        {
          organization_id: ORG,
          appointment_id: "ag-2",
          professional_id: "p-ana",
          role: "principal",
        },
      );
  });

  it("filtro por profissional pega também onde ela é APOIO; campos novos com o valor do banco", async () => {
    const r = await listaAgendamentos(sb, ORG, {
      professionalId: "p-bia",
      de: sp("2026-03-09T00:00"),
      ate: sp("2026-03-10T00:00"),
      limite: 50,
    });
    if (!r.ok) throw new Error(r.motivoParaOperador);
    expect(r.agendamentos.map((a) => a.id)).toEqual(["ag-1"]);
    expect(r.agendamentos[0]).toMatchObject({
      profissionais: [
        { id: "p-ana", papel: "principal" },
        { id: "p-bia", papel: "apoio" },
      ],
      eventTypeId: "tipo-1",
      origem: "mcp",
      autor: "ai",
      conversaId: "conv-1",
      contatoNome: "Maria",
    });
    expect(semFiltroDeOrganizacao()).toEqual([]);
  });

  it("o detalhe junta profissionais com nome, principal primeiro, e diz 'não encontrado' para id alheio", async () => {
    banco
      .linhas("contacts")
      .push({
        id: "c-1",
        organization_id: ORG,
        name: "Maria",
        display_name: null,
        phone_number: "+5511999990000",
      });
    banco.linhas("calendar_event_types").push(tipo());
    banco
      .linhas("crm_lead_links")
      .push({
        organization_id: ORG,
        lead_id: "lead-1",
        target_kind: "appointment",
        target_id: "ag-1",
        created_at: "2026-03-01",
      });

    const r = await detalheDoAgendamento(sb, ORG, "ag-1");
    if (!r.ok) throw new Error(r.motivoParaOperador);
    expect(r.detalhe.profissionais.map((p) => `${p.nome}:${p.papel}`)).toEqual([
      "Ana:principal",
      "Bia:apoio",
    ]);
    expect(r.detalhe).toMatchObject({
      tipo: { id: "tipo-1", nome: "Consulta" },
      contato: { id: "c-1", nome: "Maria", telefone: "+5511999990000" },
      leadId: "lead-1",
      conversaId: "conv-1",
      origem: "mcp",
      autor: "ai",
    });

    const alheio = await detalheDoAgendamento(sb, OUTRA, "ag-1");
    expect(alheio.ok === false && alheio.codigo).toBe("nao_encontrado");
    expect(semFiltroDeOrganizacao()).toEqual([]);
  });
});

// ─── quem saiu da equipe não atende ─────────────────────────────────────────
//
// A revogação desativa a profissional do membro, mas revogar é UM caminho (SQL
// de suporte, falha no meio, uma segunda rota amanhã). O filtro de consumo é a
// defesa em profundidade: profissional ATIVA cujo membro está revogado nesta
// organização não é candidata em degrau nenhum.
describe("membro revogado: fora da oferta mesmo com a linha ativa", () => {
  beforeEach(() => {
    banco.linhas("calendar_event_types").push(tipo());
    banco
      .linhas("calendar_professionals")
      .push(
        profissional("p-ana", { name: "Ana", schedule: JORNADA_SP, position: 1 }),
        profissional("p-ex", { name: "Ex", user_id: "u-ex", position: 2 }),
      );
    banco.linhas("attendant_availability").push({ organization_id: ORG, user_id: "u-ex", schedule: JORNADA_SP });
    banco
      .linhas("user_organizations")
      .push({ organization_id: ORG, user_id: "u-ex", revoked_at: "2026-03-01T00:00:00Z" });
    // Na OUTRA organização o mesmo usuário segue ativo — e isso não o devolve aqui.
    banco.linhas("user_organizations").push({ organization_id: OUTRA, user_id: "u-ex", revoked_at: null });
  });

  const consultar = (extra: Partial<Parameters<typeof horariosLivresDaOrg>[2]> = {}) =>
    horariosLivresDaOrg(sb, ORG, { eventTypeId: "tipo-1", de: DE, ate: ATE, agora: AGORA, ...extra });

  it("habilitada com membro revogado some de `profissionaisHabilitados`", async () => {
    habilitar("p-ana", "p-ex");
    const r = await profissionaisHabilitados(sb, ORG, "tipo-1");
    expect(r.map((p) => p.id)).toEqual(["p-ana"]);
    expect(semFiltroDeOrganizacao()).toEqual([]);
  });

  it("habilitada com membro revogado não é candidata na consulta", async () => {
    habilitar("p-ana", "p-ex");
    const r = await consultar();
    if (!r.ok) throw new Error(r.motivoParaOperador);
    expect(r.profissionais.map((p) => p.id)).toEqual(["p-ana"]);
  });

  it("CONTROLE: o mesmo membro ATIVO é candidata — o filtro é pela revogação", async () => {
    banco.linhas("user_organizations").find((v) => v.organization_id === ORG)!.revoked_at = null;
    habilitar("p-ana", "p-ex");
    const r = await consultar();
    if (!r.ok) throw new Error(r.motivoParaOperador);
    expect(r.profissionais.map((p) => p.id)).toEqual(["p-ana", "p-ex"]);
  });

  it("pedida por id, com membro revogado: `profissional_invalido`", async () => {
    habilitar("p-ana", "p-ex");
    const r = await consultar({ profissionalIds: ["p-ex"] });
    expect(r.ok === false && r.codigo).toBe("profissional_invalido");
    expect(r.ok === false && r.motivoParaOperador).toMatch(/não faz mais parte da equipe/);
  });

  it("pedida pelo legado `ownerUserId` revogado: `profissional_invalido`", async () => {
    const r = await consultar({ ownerUserId: "u-ex" });
    expect(r.ok === false && r.codigo).toBe("profissional_invalido");
  });

  it("dono padrão revogado não responde pelo tipo: `sem_responsavel`", async () => {
    banco.tabelas.set("calendar_event_types", [tipo({ default_owner_user_id: "u-ex" })]);
    const r = await consultar();
    expect(r.ok === false && r.codigo).toBe("sem_responsavel");
  });

  it("tipo cuja única habilitada saiu NÃO vira 'qualquer uma serve' para a pedida", async () => {
    // A régua de "faz este serviço" é o conjunto CRU — a mesma do marcar. Só
    // com as ativas, a Ana (nunca habilitada) passaria a ser aceita aqui e
    // recusada na hora de marcar.
    banco.linhas("calendar_professionals").find((p) => p.id === "p-ex")!.is_active = false;
    habilitar("p-ex");
    const r = await consultar({ profissionalIds: ["p-ana"] });
    expect(r.ok === false && r.codigo).toBe("profissional_invalido");
  });
});
