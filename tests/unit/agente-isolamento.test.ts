import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import type { EscopoDoAgente } from "@/agente/escopo";
import { executarFerramenta, FERRAMENTAS } from "@/agente/ferramentas";

/**
 * A assistente de suporte NÃO ENXERGA OUTRA CONTA — provado contra o pior caso.
 *
 * O dublê de banco abaixo devolve as linhas de TODAS as organizações, como a
 * RLS faz para um platform admin (`fn_is_platform_admin()` em quase toda
 * policy). Ou seja: aqui a RLS não ajuda em nada, e o isolamento tem de vir
 * inteiro do filtro explícito que cada ferramenta aplica. Se alguma ferramenta
 * esquecer o `.eq("organization_id", …)`, o segredo da organização B aparece no
 * resultado e o teste reprova.
 *
 * Os argumentos de cada chamada vêm ENVENENADOS com o id da organização B e do
 * usuário B — o que um modelo enganado por injeção mandaria. Eles têm de ser
 * descartados antes de chegar à consulta.
 */

const ORG_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ORG_B = "bbbbbbbb-0000-4000-8000-000000000002";
const USER_A = "aaaaaaaa-1111-4000-8000-000000000001";
const OUTRO_A = "aaaaaaaa-1111-4000-8000-000000000002";
const USER_B = "bbbbbbbb-1111-4000-8000-000000000001";
const SEGREDO = "SEGREDO_B";

const AGORA = new Date("2026-11-03T15:00:00.000Z"); // 12h em São Paulo
const daqui = (horas: number) => new Date(AGORA.getTime() + horas * 3600_000).toISOString();

type Linha = Record<string, unknown>;

function banco(): Record<string, Linha[]> {
  const contatoA = { name: "Maria Cliente", display_name: null, is_anonymized: false };
  const contatoB = { name: `${SEGREDO} Cliente`, display_name: null, is_anonymized: false };
  return {
    organizations: [
      { id: ORG_A, display_name: "Empresa A" },
      { id: ORG_B, display_name: `${SEGREDO} Empresa` },
    ],
    assinaturas: [
      { organization_id: ORG_A, status: "ativa", isenta: false, trial_termina_em: null, pago_ate: daqui(240) },
      { organization_id: ORG_B, status: `${SEGREDO}`, isenta: false, trial_termina_em: null, pago_ate: null },
    ],
    user_organizations: [
      { organization_id: ORG_A, user_id: USER_A, revoked_at: null },
      { organization_id: ORG_A, user_id: OUTRO_A, revoked_at: null },
      { organization_id: ORG_B, user_id: USER_B, revoked_at: null },
      { organization_id: ORG_B, user_id: "b2", revoked_at: null },
      { organization_id: ORG_B, user_id: "b3", revoked_at: null },
    ],
    channel_sessions: [
      { organization_id: ORG_A, display_name: "Zap A", phone_number: "5511911112222", status: "WORKING", archived_at: null, last_status_change_at: daqui(-5) },
      { organization_id: ORG_B, display_name: `${SEGREDO} Zap`, phone_number: "5521999998888", status: "WORKING", archived_at: null, last_status_change_at: daqui(-5) },
    ],
    crm_pipelines: [
      { id: "pa", organization_id: ORG_A, name: "Vendas A", is_default: true, is_archived: false },
      { id: "pb", organization_id: ORG_B, name: `${SEGREDO} Funil`, is_default: true, is_archived: false },
    ],
    crm_stages: [
      { id: "sa1", organization_id: ORG_A, pipeline_id: "pa", name: "Novo", is_won: false, is_lost: false, is_archived: false },
      { id: "sb1", organization_id: ORG_B, pipeline_id: "pb", name: `${SEGREDO} Etapa`, is_won: false, is_lost: false, is_archived: false },
    ],
    crm_leads: [
      { id: "la1", organization_id: ORG_A, pipeline_id: "pa", stage_id: "sa1", owner_user_id: USER_A },
      { id: "la2", organization_id: ORG_A, pipeline_id: "pa", stage_id: "sa1", owner_user_id: null },
      { id: "la3", organization_id: ORG_A, pipeline_id: "pa", stage_id: "sa1", owner_user_id: OUTRO_A },
      // Lead da B apontando para a etapa da A: só o filtro de organização o barra.
      { id: "lb1", organization_id: ORG_B, pipeline_id: "pa", stage_id: "sa1", owner_user_id: USER_B },
    ],
    conversations: [
      { organization_id: ORG_A, status: "open", assigned_to_user_id: USER_A, last_message_at: daqui(-1), contacts: contatoA },
      { organization_id: ORG_A, status: "ai_handling", assigned_to_user_id: null, last_message_at: daqui(-2), contacts: contatoA },
      { organization_id: ORG_A, status: "claimed", assigned_to_user_id: OUTRO_A, last_message_at: daqui(-3), contacts: contatoA },
      { organization_id: ORG_A, status: "closed", assigned_to_user_id: USER_A, last_message_at: daqui(-4), contacts: contatoA },
      { organization_id: ORG_B, status: "open", assigned_to_user_id: USER_B, last_message_at: daqui(-1), contacts: contatoB },
    ],
    calendar_professionals: [
      { id: "prof-a", organization_id: ORG_A, user_id: USER_A },
      { id: "prof-b", organization_id: ORG_B, user_id: USER_B },
      // Profissional da B com o MESMO user_id da A (pessoa que é das duas): o
      // filtro de organização impede que a agenda da B entre pela participação.
      { id: "prof-b-a", organization_id: ORG_B, user_id: USER_A },
    ],
    calendar_appointment_professionals: [
      { organization_id: ORG_A, appointment_id: "ap-apoio", professional_id: "prof-a", starts_at: daqui(48) },
      { organization_id: ORG_B, appointment_id: "ap-b", professional_id: "prof-b-a", starts_at: daqui(30) },
    ],
    calendar_appointments: [
      { id: "ap-dona", organization_id: ORG_A, owner_user_id: USER_A, title: "Consulta Maria", starts_at: daqui(24), ends_at: daqui(25), status: "confirmed", contacts: contatoA },
      { id: "ap-apoio", organization_id: ORG_A, owner_user_id: OUTRO_A, title: "Apoio", starts_at: daqui(48), ends_at: daqui(49), status: "pending", contacts: contatoA },
      { id: "ap-colega", organization_id: ORG_A, owner_user_id: OUTRO_A, title: "Agenda do colega", starts_at: daqui(26), ends_at: daqui(27), status: "confirmed", contacts: contatoA },
      { id: "ap-b", organization_id: ORG_B, owner_user_id: USER_A, title: `${SEGREDO} Compromisso`, starts_at: daqui(30), ends_at: daqui(31), status: "confirmed", contacts: contatoB },
    ],
    contacts: [
      { organization_id: ORG_A, name: "Maria Cliente", display_name: null, phone_number: "5511987651234", tags: ["vip"], is_anonymized: false, created_at: daqui(-100) },
      { organization_id: ORG_B, name: `Maria ${SEGREDO}`, display_name: null, phone_number: "5521900009999", tags: [SEGREDO], is_anonymized: false, created_at: daqui(-100) },
    ],
    ai_budgets: [
      { organization_id: ORG_A, current_month_consumed_cents: 1234, monthly_limit_cents: 5000, is_throttled: false, is_disabled: false },
      { organization_id: ORG_B, current_month_consumed_cents: 999999, monthly_limit_cents: 1, is_throttled: true, is_disabled: true },
    ],
    ai_invocations: [
      { organization_id: ORG_A, created_at: daqui(-24) },
      { organization_id: ORG_B, created_at: daqui(-24) },
      { organization_id: ORG_B, created_at: daqui(-24) },
    ],
  };
}

type Filtro = [op: string, coluna: string, valor: unknown];

/** Uma consulta do dublê: registra os filtros e os aplica sobre TODAS as linhas da tabela. */
class Consulta {
  readonly filtros: Filtro[] = [];
  private contar = false;
  private cabeca = false;
  private teto: number | undefined;

  constructor(
    readonly tabela: string,
    private readonly linhas: Linha[],
  ) {}

  select(_colunas?: string, opts?: { count?: string; head?: boolean }) {
    this.contar = !!opts?.count;
    this.cabeca = !!opts?.head;
    return this;
  }
  eq(c: string, v: unknown) {
    this.filtros.push(["eq", c, v]);
    return this;
  }
  in(c: string, v: unknown[]) {
    this.filtros.push(["in", c, v]);
    return this;
  }
  is(c: string, v: unknown) {
    this.filtros.push(["is", c, v]);
    return this;
  }
  gte(c: string, v: unknown) {
    this.filtros.push(["gte", c, v]);
    return this;
  }
  lt(c: string, v: unknown) {
    this.filtros.push(["lt", c, v]);
    return this;
  }
  not(c: string, op: string, v: unknown) {
    this.filtros.push([`not.${op}`, c, v]);
    return this;
  }
  or(expr: string) {
    this.filtros.push(["or", "", expr]);
    return this;
  }
  order() {
    return this;
  }
  limit(n: number) {
    this.teto = n;
    return this;
  }
  maybeSingle() {
    return this.executar().then((r) => ({ ...r, data: (r.data as Linha[])[0] ?? null }));
  }
  single() {
    return this.maybeSingle();
  }
  insert(): never {
    throw new Error("ESCRITA PROIBIDA: insert");
  }
  update(): never {
    throw new Error("ESCRITA PROIBIDA: update");
  }
  upsert(): never {
    throw new Error("ESCRITA PROIBIDA: upsert");
  }
  delete(): never {
    throw new Error("ESCRITA PROIBIDA: delete");
  }
  then<T1, T2>(ok?: ((v: { data: unknown; error: null; count: number | null }) => T1) | null, erro?: ((e: unknown) => T2) | null) {
    return this.executar().then(ok, erro);
  }

  private executar() {
    let rs = this.linhas.filter((l) => this.filtros.every((f) => passa(l, f)));
    const total = rs.length;
    if (this.teto !== undefined) rs = rs.slice(0, this.teto);
    return Promise.resolve({ data: this.cabeca ? null : rs, error: null, count: this.contar ? total : null });
  }
}

function condicaoSimples(l: Linha, cond: string): boolean {
  const [coluna, op, ...resto] = cond.split(".");
  const valor = resto.join(".");
  const atual = l[coluna!];
  if (op === "eq") return String(atual) === valor;
  if (op === "is") return valor === "null" ? atual == null : String(atual) === valor;
  if (op === "ilike") {
    const padrao = valor.replace(/\\([%_])/g, "$1").replace(/%/g, "");
    return String(atual ?? "").toLowerCase().includes(padrao.toLowerCase());
  }
  throw new Error(`condição não suportada pelo dublê: ${cond}`);
}

function passa(l: Linha, [op, c, v]: Filtro): boolean {
  switch (op) {
    case "eq":
      return l[c] === v;
    case "in":
      return (v as unknown[]).includes(l[c]);
    case "is":
      return v === null ? l[c] == null : l[c] === v;
    case "gte":
      return String(l[c]) >= String(v);
    case "lt":
      return String(l[c]) < String(v);
    case "not.in":
      return !String(v).replace(/[()]/g, "").split(",").includes(String(l[c]));
    case "or":
      return String(v)
        .split(",")
        .some((cond) => condicaoSimples(l, cond));
    default:
      throw new Error(`filtro não suportado pelo dublê: ${op}`);
  }
}

function dubleDoBanco() {
  const dados = banco();
  const log: Consulta[] = [];
  const cliente = {
    from(tabela: string) {
      const q = new Consulta(tabela, dados[tabela] ?? []);
      log.push(q);
      return q;
    },
    rpc(): never {
      throw new Error("ESCRITA/RPC PROIBIDA");
    },
  };
  return { cliente: cliente as unknown as SupabaseClient, log };
}

function escopo(role: EscopoDoAgente["role"], visibilityMode: EscopoDoAgente["visibilityMode"] = "own_and_unassigned"): EscopoDoAgente {
  return { organizationId: ORG_A, userId: USER_A, role, visibilityMode, fuso: "America/Sao_Paulo" };
}

/** O que um modelo enganado mandaria: o id da outra conta em toda chave plausível. */
const ARGUMENTOS_ENVENENADOS = {
  organization_id: ORG_B,
  org_id: ORG_B,
  tenant_id: ORG_B,
  user_id: USER_B,
  owner_user_id: USER_B,
  kanban: SEGREDO,
  nome: "Maria",
  periodo: "proximos_7_dias",
};

async function rodar(nome: string, e: EscopoDoAgente, args: unknown = ARGUMENTOS_ENVENENADOS) {
  const { cliente, log } = dubleDoBanco();
  const texto = await executarFerramenta(nome, JSON.stringify(args), { supabase: cliente, escopo: e, agora: AGORA });
  return { texto, json: JSON.parse(texto) as Record<string, unknown>, log };
}

const TODAS = FERRAMENTAS.map((f) => f.nome);

describe("assistente de suporte · isolamento entre organizações (RLS como a de platform admin)", () => {
  it.each(TODAS)("%s: nada da organização B volta, mesmo com o id da B nos argumentos", async (nome) => {
    for (const papel of ["viewer", "agent", "manager", "admin"] as const) {
      const { texto, json } = await rodar(nome, escopo(papel));
      expect(json.erro, `${nome}/${papel}: ${texto}`).toBeUndefined();
      expect(texto).not.toContain(SEGREDO);
      expect(texto).not.toContain(ORG_B);
      expect(texto).not.toContain(USER_B);
    }
  });

  it.each(TODAS)("%s: TODA consulta é presa à organização da sessão, e nenhuma cita a B", async (nome) => {
    const { log } = await rodar(nome, escopo("admin"));
    expect(log.length).toBeGreaterThan(0);
    for (const q of log) {
      const presa = q.filtros.some(
        ([op, c, v]) => op === "eq" && v === ORG_A && (c === "organization_id" || (q.tabela === "organizations" && c === "id")),
      );
      expect(presa, `${nome}: consulta em ${q.tabela} sem filtro de organização`).toBe(true);
      const valores = JSON.stringify(q.filtros);
      expect(valores).not.toContain(ORG_B);
      expect(valores).not.toContain(USER_B);
    }
  });

  it("os dados da PRÓPRIA conta continuam chegando (o isolamento não é uma resposta vazia por acidente)", async () => {
    const contato = await rodar("buscar_contato", escopo("agent"));
    expect(contato.json).toEqual({
      contatos: [{ nome: "Maria Cliente", telefone: "•••• 1234", tags: ["vip"], cadastrado_em: expect.any(String) }],
    });

    const conexoes = await rodar("status_conexoes", escopo("viewer"));
    expect(conexoes.json.conexoes).toEqual([
      { nome: "Zap A", numero: "•••• 2222", situacao: "conectado", desde: expect.any(String) },
    ]);

    const resumo = await rodar("resumo_conta", escopo("admin"));
    expect(resumo.json).toMatchObject({
      organizacao: "Empresa A",
      usuarios_ativos: 2,
      conexoes_whatsapp: { total: 1, conectadas: 1 },
      assinatura: { situacao: "ativa" },
    });

    const uso = await rodar("uso_ia_mes", escopo("manager"));
    expect(uso.json).toMatchObject({ gasto_no_mes: "US$ 12.34", chamadas_de_ia_no_mes: 1, ia_pausada_por_orcamento: false });
  });

  it("telefone de terceiro sai mascarado — nunca o número inteiro", async () => {
    const { texto } = await rodar("buscar_contato", escopo("admin"));
    expect(texto).not.toContain("5511987651234");
    expect(texto).not.toContain("987651234");
  });

  it("agent vê só as conversas e leads dele e os sem responsável (o bypass de admin não vaza visibilidade)", async () => {
    const conversas = await rodar("conversas_abertas", escopo("agent", "own_and_unassigned"));
    expect(conversas.json).toMatchObject({ em_aberto: 2, atribuidas_a_voce: 1, sem_responsavel: 1, com_a_ia: 1 });

    const so = await rodar("conversas_abertas", escopo("agent", "own"));
    expect(so.json).toMatchObject({ em_aberto: 1, atribuidas_a_voce: 1, sem_responsavel: 0 });

    const gerente = await rodar("conversas_abertas", escopo("manager"));
    expect(gerente.json).toMatchObject({ em_aberto: 3 });

    const leads = await rodar("leads_por_etapa", escopo("agent", "own_and_unassigned"));
    expect(leads.json.etapas).toEqual([{ etapa: "Novo", leads: 2 }]);
    const leadsGerente = await rodar("leads_por_etapa", escopo("manager"));
    expect(leadsGerente.json.etapas).toEqual([{ etapa: "Novo", leads: 3 }]);
  });

  it("minha_agenda: só a da própria pessoa (dona ou participante), nem do colega — mesmo para admin", async () => {
    const { json } = await rodar("minha_agenda", escopo("admin"), { periodo: "proximos_7_dias" });
    const titulos = (json.agendamentos as Array<{ titulo: string }>).map((a) => a.titulo);
    expect(titulos).toEqual(["Consulta Maria", "Apoio"]);
  });

  it("papel abaixo do exigido pela tela recebe 'sem permissão', não o dado", async () => {
    const uso = await rodar("uso_ia_mes", escopo("agent"));
    expect(uso.json).toMatchObject({ indisponivel: true });
    expect(uso.texto).not.toContain("12.34");

    const resumo = await rodar("resumo_conta", escopo("manager"));
    expect(resumo.json.assinatura).toMatchObject({ indisponivel: true });
    const resumoAgent = await rodar("resumo_conta", escopo("agent"));
    expect(resumoAgent.json.usuarios_ativos).toBeUndefined();
  });

  it("ferramenta desconhecida e argumento ilegível viram erro curto, sem lançar", async () => {
    expect((await rodar("apagar_lead", escopo("admin"))).json).toEqual({ erro: "ferramenta inexistente" });
    const { cliente } = dubleDoBanco();
    const texto = await executarFerramenta("buscar_contato", "{nao é json", { supabase: cliente, escopo: escopo("admin"), agora: AGORA });
    expect(JSON.parse(texto)).toEqual({ erro: "argumentos ilegíveis" });
  });
});

describe("assistente de suporte · só leitura, por construção", () => {
  const RAIZ = process.cwd();
  const doAgente = readdirSync(join(RAIZ, "agente"))
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => `agente/${f}`);

  it("a lista de ferramentas é a fixa, e nenhum nome sugere escrita", () => {
    expect([...TODAS].sort()).toEqual(
      ["buscar_contato", "conversas_abertas", "leads_por_etapa", "minha_agenda", "resumo_conta", "status_conexoes", "uso_ia_mes"].sort(),
    );
    for (const nome of TODAS) {
      expect(nome).not.toMatch(/criar|crie|alterar|atualizar|apagar|excluir|deletar|enviar|mover|editar|salvar|gravar|set_|update|delete|insert|send/i);
    }
  });

  it("o código das ferramentas não tem chamada de escrita nem RPC", () => {
    const fonte = readFileSync(join(RAIZ, "agente/ferramentas.ts"), "utf8");
    for (const proibido of [".insert(", ".update(", ".upsert(", ".delete(", ".rpc(", "storage.", "auth.admin"]) {
      expect(fonte, `agente/ferramentas.ts contém ${proibido}`).not.toContain(proibido);
    }
  });

  it("só agente/registro.server.ts importa o client de service role (e nunca as ferramentas)", () => {
    const importaAdmin = /from\s+["']@\/lib\/supabase\/admin["']|createAdminClient|SUPABASE_SERVICE_ROLE/;
    const comAdmin = doAgente.filter((f) => importaAdmin.test(readFileSync(join(RAIZ, f), "utf8")));
    expect(comAdmin).toEqual(["agente/registro.server.ts"]);

    for (const f of [...doAgente.filter((x) => x !== "agente/registro.server.ts"), "app/api/v1/agente/_handler.ts"]) {
      const fonte = readFileSync(join(RAIZ, f), "utf8");
      expect(fonte, `${f} importa o client de service role`).not.toMatch(importaAdmin);
    }
    // As ferramentas também não alcançam o registro (que tem o admin) por tabela.
    expect(readFileSync(join(RAIZ, "agente/ferramentas.ts"), "utf8")).not.toMatch(/registro\.server|agente_mensagens|agente_conversas/);
  });
});
