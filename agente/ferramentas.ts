/**
 * As ferramentas da assistente de suporte — TODAS de leitura, numa lista fixa.
 *
 * ── O que este arquivo NUNCA faz ────────────────────────────────────────────
 *
 *  - Escrever. Não há `.insert`, `.update`, `.upsert`, `.delete` nem `.rpc`
 *    aqui; `tests/unit/agente-isolamento.test.ts` reprova se aparecer.
 *  - Usar o client de service role. Toda consulta é feita com o client do
 *    USUÁRIO (`lib/supabase/server`), sob a RLS dele. O teste reprova import de
 *    `lib/supabase/admin`.
 *  - Aceitar organização ou usuário do modelo. Os argumentos de cada
 *    ferramenta são um nome a procurar, um período ou um Kanban — e passam por
 *    Zod que DESCARTA chave desconhecida. Um `organization_id` injetado no
 *    argumento some antes de chegar à consulta.
 *  - Montar consulta genérica ("leia a tabela X"). Cada ferramenta responde uma
 *    pergunta de uso, com os campos mínimos e no máximo `LIMITE_DE_LINHAS`.
 *
 * ── A camada que não depende da RLS ─────────────────────────────────────────
 *
 * Toda consulta leva `.eq("organization_id", escopo.organizationId)` (ou
 * `.eq("id", …)` na própria `organizations`), e o recorte por pessoa do inbox e
 * do funil é reaplicado por `aplicarRecorte`. Ver `agente/escopo.ts` para o
 * porquê: a RLS deixa o platform admin passar, e a assistente não herda isso.
 *
 * ── Gate de papel ───────────────────────────────────────────────────────────
 *
 * O mesmo `minRole` que a TELA correspondente tem em `lib/navigation/registry.ts`:
 * quem não abre "Uso e orçamento" (manager+) não lê o gasto de IA pela
 * assistente; quem não abre "Assinatura" (admin) não lê a situação do plano.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { nomeDoContato } from "@/lib/contacts/rotulo-do-contato";
import { CONVERSATION_TERMINAL_STATUSES } from "@/lib/schemas/messaging";

import { aplicarRecorte, descricaoDoRecorte, papelAoMenos, recorteDeVisibilidade, type EscopoDoAgente } from "./escopo";
import { mascararNumerosLongos, mascararTelefone } from "./mascara";
import { dataCurta, dataHoraCurta, inicioDoDia, inicioDoMes } from "./tempo";

/** Teto de linhas de qualquer lista devolvida ao modelo. */
export const LIMITE_DE_LINHAS = 20;
/** Teto do JSON devolvido ao modelo por chamada de ferramenta. */
export const LIMITE_DE_CARACTERES = 4000;

export interface ContextoDaFerramenta {
  supabase: SupabaseClient;
  escopo: EscopoDoAgente;
  agora: Date;
}

/** JSON Schema no formato de `tools[].function.parameters` (OpenAI/OpenRouter). */
type EsquemaJson = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties: false;
};

export interface Ferramenta {
  nome: string;
  descricao: string;
  parametros: EsquemaJson;
  executar(ctx: ContextoDaFerramenta, bruto: unknown): Promise<unknown>;
}

const SEM_ARGUMENTOS: EsquemaJson = { type: "object", properties: {}, additionalProperties: false };

const STATUS_DA_CONEXAO: Record<string, string> = {
  WORKING: "conectado",
  STARTING: "iniciando",
  SCAN_QR_CODE: "aguardando leitura do QR Code",
  STOPPED: "parado",
  FAILED: "com falha",
};

const STATUS_DA_CONVERSA: Record<string, string> = {
  open: "aberta",
  pending: "pendente",
  claimed: "em atendimento",
  ai_handling: "com a IA",
  resolved: "resolvida",
};

const STATUS_DO_AGENDAMENTO: Record<string, string> = {
  pending: "a confirmar",
  confirmed: "confirmado",
  cancelled: "cancelado",
  canceled: "cancelado",
  completed: "realizado",
  no_show: "não compareceu",
};

const STATUS_DA_ASSINATURA: Record<string, string> = {
  trial: "período de teste",
  ativa: "ativa",
  inadimplente: "pagamento em atraso",
  cancelada: "cancelada",
};

/** Mesmo escape de `app/api/v1/search/_handler.ts`: curinga do LIKE e delimitador do `.or()`. */
function paraFiltro(bruto: string): string {
  return bruto
    .trim()
    .replace(/[%_]/g, (m) => `\\${m}`)
    .replace(/[,()]/g, " ");
}

function semPermissao(tela: string, papel: string) {
  return {
    indisponivel: true,
    motivo: `Essa informação fica na tela "${tela}", que só ${papel} acessa. Peça a quem administra a conta.`,
  };
}

/** Lança com mensagem curta: o laço transforma em `{erro}` para o modelo, sem detalhe de banco. */
function conferir<T>(r: { data: T; error: { message: string } | null }, onde: string): T {
  if (r.error) throw new Error(`consulta de ${onde} falhou`);
  return r.data;
}

// ─── resumo_conta ────────────────────────────────────────────────────────────

const resumoConta: Ferramenta = {
  nome: "resumo_conta",
  descricao:
    "Resumo da conta (organização) de quem está perguntando: nome da organização, papel da pessoa, " +
    "situação da assinatura (só admin), quantos usuários ativos (gerente ou admin) e quantas conexões de WhatsApp estão conectadas.",
  parametros: SEM_ARGUMENTOS,
  async executar({ supabase, escopo }) {
    const org = escopo.organizationId;
    const [orgR, assinR, membrosR, canaisR] = await Promise.all([
      supabase.from("organizations").select("display_name").eq("id", org).maybeSingle(),
      papelAoMenos(escopo, "admin")
        ? supabase
            .from("assinaturas")
            .select("status, isenta, trial_termina_em, pago_ate")
            .eq("organization_id", org)
            .maybeSingle()
        : Promise.resolve(null),
      papelAoMenos(escopo, "manager")
        ? supabase
            .from("user_organizations")
            .select("user_id", { count: "exact", head: true })
            .eq("organization_id", org)
            .is("revoked_at", null)
        : Promise.resolve(null),
      supabase
        .from("channel_sessions")
        .select("status")
        .eq("organization_id", org)
        .is("archived_at", null)
        .limit(50),
    ]);

    const orgRow = conferir(orgR, "organização") as { display_name?: string | null } | null;
    const canais = (conferir(canaisR, "conexões") ?? []) as Array<{ status: string | null }>;

    const saida: Record<string, unknown> = {
      organizacao: orgRow?.display_name ?? null,
      seu_papel: escopo.role,
      conexoes_whatsapp: {
        total: canais.length,
        conectadas: canais.filter((c) => c.status === "WORKING").length,
      },
    };

    if (assinR) {
      const a = conferir(assinR, "assinatura") as {
        status: string;
        isenta: boolean;
        trial_termina_em: string | null;
        pago_ate: string | null;
      } | null;
      saida.assinatura = a
        ? {
            situacao: a.isenta ? "isenta" : (STATUS_DA_ASSINATURA[a.status] ?? a.status),
            teste_termina_em: dataCurta(escopo.fuso, a.trial_termina_em),
            paga_ate: dataCurta(escopo.fuso, a.pago_ate),
          }
        : null;
    } else {
      saida.assinatura = semPermissao("Assinatura", "admin");
    }

    if (membrosR) {
      if (membrosR.error) throw new Error("consulta de usuários falhou");
      saida.usuarios_ativos = membrosR.count ?? 0;
    }
    return saida;
  },
};

// ─── leads_por_etapa ─────────────────────────────────────────────────────────

const argsLeads = z.object({ kanban: z.string().trim().max(80).optional() });

const leadsPorEtapa: Ferramenta = {
  nome: "leads_por_etapa",
  descricao:
    "Quantos leads (negócios) há em cada etapa (coluna) de um Kanban de vendas da organização. " +
    "Sem nome, usa o Kanban padrão. Respeita o que a pessoa pode ver (atendente pode ver só os próprios).",
  parametros: {
    type: "object",
    properties: {
      kanban: { type: "string", description: "Nome (ou parte do nome) do Kanban. Opcional." },
    },
    additionalProperties: false,
  },
  async executar({ supabase, escopo }, bruto) {
    const args = argsLeads.parse(bruto ?? {});
    const org = escopo.organizationId;

    const pipelines = (conferir(
      await supabase
        .from("crm_pipelines")
        .select("id, name, is_default")
        .eq("organization_id", org)
        .eq("is_archived", false)
        .order("position", { ascending: true })
        .limit(LIMITE_DE_LINHAS),
      "Kanbans",
    ) ?? []) as Array<{ id: string; name: string; is_default: boolean }>;

    if (pipelines.length === 0) return { kanban: null, etapas: [], observacao: "A organização ainda não tem Kanban." };

    const procurado = args.kanban?.toLocaleLowerCase("pt-BR");
    const escolhido =
      (procurado ? pipelines.find((p) => p.name.toLocaleLowerCase("pt-BR").includes(procurado)) : undefined) ??
      pipelines.find((p) => p.is_default) ??
      pipelines[0]!;

    const etapas = (conferir(
      await supabase
        .from("crm_stages")
        .select("id, name, is_won, is_lost")
        .eq("organization_id", org)
        .eq("pipeline_id", escolhido.id)
        .eq("is_archived", false)
        .order("position", { ascending: true })
        .limit(LIMITE_DE_LINHAS),
      "etapas",
    ) ?? []) as Array<{ id: string; name: string; is_won: boolean; is_lost: boolean }>;

    const contagens = await Promise.all(
      etapas.map(async (e) => {
        const r = await aplicarRecorte(
          supabase
            .from("crm_leads")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", org)
            .eq("pipeline_id", escolhido.id)
            .eq("stage_id", e.id),
          "owner_user_id",
          escopo,
        );
        if (r.error) throw new Error("contagem de leads falhou");
        return {
          etapa: rotuloCurto(e.name),
          leads: r.count ?? 0,
          ...(e.is_won ? { tipo: "ganho" } : e.is_lost ? { tipo: "perdido" } : {}),
        };
      }),
    );

    return {
      kanban: escolhido.name,
      outros_kanbans: pipelines.filter((p) => p.id !== escolhido.id).map((p) => p.name),
      contando: descricaoDoRecorte(recorteDeVisibilidade(escopo)),
      etapas: contagens,
    };
  },
};

// ─── conversas_abertas ───────────────────────────────────────────────────────

const conversasAbertas: Ferramenta = {
  nome: "conversas_abertas",
  descricao:
    "Conversas de WhatsApp em aberto no Inbox que a pessoa pode ver: total, quantas são dela, quantas estão sem " +
    "responsável e quantas a IA está atendendo, mais as 5 com mensagem mais recente (só o nome do contato).",
  parametros: SEM_ARGUMENTOS,
  async executar({ supabase, escopo }) {
    const org = escopo.organizationId;
    const terminais = `(${CONVERSATION_TERMINAL_STATUSES.join(",")})`;
    const base = () =>
      aplicarRecorte(
        supabase
          .from("conversations")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", org)
          .not("status", "in", terminais),
        "assigned_to_user_id",
        escopo,
      );

    const [total, minhas, semDono, comIa, recentes] = await Promise.all([
      base(),
      base().eq("assigned_to_user_id", escopo.userId),
      base().is("assigned_to_user_id", null),
      base().eq("status", "ai_handling"),
      aplicarRecorte(
        supabase
          .from("conversations")
          .select("status, assigned_to_user_id, last_message_at, contacts(name, display_name, is_anonymized)")
          .eq("organization_id", org)
          .not("status", "in", terminais),
        "assigned_to_user_id",
        escopo,
      )
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(5),
    ]);

    for (const r of [total, minhas, semDono, comIa]) if (r.error) throw new Error("contagem de conversas falhou");
    const linhas = (conferir(recentes, "conversas") ?? []) as unknown as Array<{
      status: string;
      assigned_to_user_id: string | null;
      last_message_at: string | null;
      contacts: ContatoEmbutido | ContatoEmbutido[] | null;
    }>;

    return {
      contando: descricaoDoRecorte(recorteDeVisibilidade(escopo)),
      em_aberto: total.count ?? 0,
      atribuidas_a_voce: minhas.count ?? 0,
      sem_responsavel: semDono.count ?? 0,
      com_a_ia: comIa.count ?? 0,
      mais_recentes: linhas.map((c) => ({
        contato: rotuloDoContato(c.contacts),
        situacao: STATUS_DA_CONVERSA[c.status] ?? c.status,
        responsavel:
          c.assigned_to_user_id === escopo.userId ? "você" : c.assigned_to_user_id ? "outra pessoa" : "ninguém",
        ultima_mensagem: dataHoraCurta(escopo.fuso, c.last_message_at),
      })),
    };
  },
};

type ContatoEmbutido = { name: string | null; display_name: string | null; is_anonymized?: boolean | null };

function rotuloDoContato(c: ContatoEmbutido | ContatoEmbutido[] | null | undefined): string {
  const um = Array.isArray(c) ? c[0] : c;
  if (!um) return "—";
  if (um.is_anonymized) return "Cliente anonimizado";
  return rotuloCurto(nomeDoContato(um) ?? "—");
}

const TAMANHO_MAXIMO_DO_ROTULO = 60;

/**
 * Nome digitado por terceiro (contato, conexão) vai ao modelo como DADO: uma
 * linha, curto e sem número longo. Quebra de linha e texto comprido são o
 * formato de quem tenta escrever instrução dentro do próprio nome.
 */
function rotuloCurto(bruto: string): string {
  const umaLinha = mascararNumerosLongos(bruto.replace(/\s+/g, " ").trim());
  return umaLinha.length > TAMANHO_MAXIMO_DO_ROTULO
    ? `${umaLinha.slice(0, TAMANHO_MAXIMO_DO_ROTULO - 1)}…`
    : umaLinha || "—";
}

// ─── minha_agenda ────────────────────────────────────────────────────────────

const PERIODOS = ["hoje", "amanha", "esta_semana", "proximos_7_dias"] as const;
const argsAgenda = z.object({ periodo: z.enum(PERIODOS).optional() });

function intervaloDoPeriodo(periodo: (typeof PERIODOS)[number], fuso: string, agora: Date): [Date, Date] {
  switch (periodo) {
    case "hoje":
      return [inicioDoDia(fuso, agora), inicioDoDia(fuso, agora, 1)];
    case "amanha":
      return [inicioDoDia(fuso, agora, 1), inicioDoDia(fuso, agora, 2)];
    case "esta_semana": {
      // Semana de domingo a sábado, como o calendário da Agenda.
      const diaDaSemana = new Date(inicioDoDia(fuso, agora).getTime() + 12 * 3600_000).getUTCDay();
      return [inicioDoDia(fuso, agora, -diaDaSemana), inicioDoDia(fuso, agora, 7 - diaDaSemana)];
    }
    case "proximos_7_dias":
      return [inicioDoDia(fuso, agora), inicioDoDia(fuso, agora, 7)];
  }
}

const COLUNAS_DO_AGENDAMENTO = "id, title, starts_at, ends_at, status, contacts(name, display_name, is_anonymized)";

const minhaAgenda: Ferramenta = {
  nome: "minha_agenda",
  descricao:
    "Agendamentos da PRÓPRIA pessoa (em que ela atende ou participa) num período. Nunca mostra a agenda de colegas.",
  parametros: {
    type: "object",
    properties: {
      periodo: {
        type: "string",
        enum: [...PERIODOS],
        description: "hoje, amanha, esta_semana ou proximos_7_dias (padrão).",
      },
    },
    additionalProperties: false,
  },
  async executar({ supabase, escopo, agora }, bruto) {
    const args = argsAgenda.parse(bruto ?? {});
    const periodo = args.periodo ?? "proximos_7_dias";
    const org = escopo.organizationId;
    const [inicio, fim] = intervaloDoPeriodo(periodo, escopo.fuso, agora);

    // "Minha" = sou a dona (legado por `owner_user_id`) ou participo como
    // profissional com login. Gerente vê a agenda de todos NA TELA — aqui não:
    // a pergunta é "a minha agenda".
    const profissionais = (conferir(
      await supabase
        .from("calendar_professionals")
        .select("id")
        .eq("organization_id", org)
        .eq("user_id", escopo.userId)
        .limit(5),
      "profissionais",
    ) ?? []) as Array<{ id: string }>;

    const [comoDona, participacoes] = await Promise.all([
      supabase
        .from("calendar_appointments")
        .select(COLUNAS_DO_AGENDAMENTO)
        .eq("organization_id", org)
        .eq("owner_user_id", escopo.userId)
        .gte("starts_at", inicio.toISOString())
        .lt("starts_at", fim.toISOString())
        .order("starts_at", { ascending: true })
        .limit(50),
      profissionais.length > 0
        ? supabase
            .from("calendar_appointment_professionals")
            .select("appointment_id")
            .eq("organization_id", org)
            .in(
              "professional_id",
              profissionais.map((p) => p.id),
            )
            .gte("starts_at", inicio.toISOString())
            .lt("starts_at", fim.toISOString())
            .limit(50)
        : Promise.resolve({ data: [] as Array<{ appointment_id: string }>, error: null }),
    ]);

    type Linha = {
      id: string;
      title: string;
      starts_at: string;
      ends_at: string;
      status: string;
      contacts: ContatoEmbutido | ContatoEmbutido[] | null;
    };
    const proprios = (conferir(comoDona, "agenda") ?? []) as unknown as Linha[];
    const jaTenho = new Set(proprios.map((a) => a.id));
    const faltam = ((conferir(participacoes, "participações") ?? []) as Array<{ appointment_id: string }>)
      .map((p) => p.appointment_id)
      .filter((id) => !jaTenho.has(id));

    let extras: Linha[] = [];
    if (faltam.length > 0) {
      extras = (conferir(
        await supabase
          .from("calendar_appointments")
          .select(COLUNAS_DO_AGENDAMENTO)
          .eq("organization_id", org)
          .in("id", faltam)
          .limit(50),
        "agenda",
      ) ?? []) as unknown as Linha[];
    }

    const todos = [...proprios, ...extras].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    return {
      periodo,
      total: todos.length,
      agendamentos: todos.slice(0, LIMITE_DE_LINHAS).map((a) => ({
        quando: dataHoraCurta(escopo.fuso, a.starts_at),
        ate: dataHoraCurta(escopo.fuso, a.ends_at),
        titulo: rotuloCurto(a.title ?? ""),
        cliente: rotuloDoContato(a.contacts),
        situacao: STATUS_DO_AGENDAMENTO[a.status] ?? a.status,
      })),
    };
  },
};

// ─── buscar_contato ──────────────────────────────────────────────────────────

const argsContato = z.object({ nome: z.string().trim().min(2).max(60) });

const buscarContato: Ferramenta = {
  nome: "buscar_contato",
  descricao:
    "Procura contatos (clientes) da organização pelo nome. Devolve no máximo 5, com o telefone MASCARADO " +
    "(só os 4 últimos dígitos). Use para confirmar se um cliente está cadastrado.",
  parametros: {
    type: "object",
    properties: { nome: { type: "string", description: "Nome ou parte do nome (mínimo 2 letras)." } },
    required: ["nome"],
    additionalProperties: false,
  },
  async executar({ supabase, escopo }, bruto) {
    const args = argsContato.parse(bruto ?? {});
    const termo = paraFiltro(args.nome);
    if (termo.length < 2) return { contatos: [] };

    const linhas = (conferir(
      await supabase
        .from("contacts")
        .select("name, display_name, phone_number, tags, created_at")
        .eq("organization_id", escopo.organizationId)
        .eq("is_anonymized", false)
        .or(`name.ilike.%${termo}%,display_name.ilike.%${termo}%`)
        .order("created_at", { ascending: false })
        .limit(5),
      "contatos",
    ) ?? []) as Array<{
      name: string | null;
      display_name: string | null;
      phone_number: string | null;
      tags: string[] | null;
      created_at: string;
    }>;

    return {
      contatos: linhas.map((c) => ({
        nome: rotuloCurto(nomeDoContato(c) ?? "—"),
        telefone: mascararTelefone(c.phone_number),
        tags: (c.tags ?? []).slice(0, 5),
        cadastrado_em: dataCurta(escopo.fuso, c.created_at),
      })),
    };
  },
};

// ─── uso_ia_mes ──────────────────────────────────────────────────────────────

const usoIaMes: Ferramenta = {
  nome: "uso_ia_mes",
  descricao:
    "Gasto de IA da organização no mês corrente (em dólar), o limite mensal configurado, se a IA está pausada " +
    "por orçamento e quantas chamadas de IA houve no mês. Só gerente ou admin.",
  parametros: SEM_ARGUMENTOS,
  async executar({ supabase, escopo, agora }) {
    if (!papelAoMenos(escopo, "manager")) return semPermissao("Uso e orçamento", "gerente ou admin");
    const org = escopo.organizationId;
    const [orcR, chamadasR] = await Promise.all([
      supabase
        .from("ai_budgets")
        .select("current_month_consumed_cents, monthly_limit_cents, is_throttled, is_disabled")
        .eq("organization_id", org)
        .maybeSingle(),
      // `llm_calls` é a ÚNICA tabela de telemetria desde a migration 0130 —
      // `ai_invocations` não tem escritor e a contagem dela congela
      // (`tests/unit/telemetria-tem-um-leitor-so.test.ts`).
      supabase
        .from("llm_calls")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", org)
        .gte("created_at", inicioDoMes(escopo.fuso, agora).toISOString()),
    ]);
    const orc = conferir(orcR, "orçamento") as {
      current_month_consumed_cents: number | string | null;
      monthly_limit_cents: number | null;
      is_throttled: boolean;
      is_disabled: boolean;
    } | null;
    if (chamadasR.error) throw new Error("contagem de chamadas falhou");

    const usd = (centavos: number | string | null | undefined) =>
      `US$ ${(Number(centavos ?? 0) / 100).toFixed(2)}`;
    return {
      gasto_no_mes: usd(orc?.current_month_consumed_cents),
      limite_mensal: orc ? usd(orc.monthly_limit_cents) : null,
      ia_pausada_por_orcamento: orc ? orc.is_throttled || orc.is_disabled : false,
      chamadas_de_ia_no_mes: chamadasR.count ?? 0,
      onde_ver: "Inteligência Artificial › Uso e orçamento",
    };
  },
};

// ─── status_conexoes ─────────────────────────────────────────────────────────

const statusConexoes: Ferramenta = {
  nome: "status_conexoes",
  descricao:
    "Situação de cada conexão de WhatsApp da organização (conectada, aguardando QR Code, com falha…), " +
    "com o final do número. Use quando perguntarem se o WhatsApp está conectado.",
  parametros: SEM_ARGUMENTOS,
  async executar({ supabase, escopo }) {
    const linhas = (conferir(
      await supabase
        .from("channel_sessions")
        .select("display_name, phone_number, status, last_status_change_at")
        .eq("organization_id", escopo.organizationId)
        .is("archived_at", null)
        .order("created_at", { ascending: true })
        .limit(LIMITE_DE_LINHAS),
      "conexões",
    ) ?? []) as Array<{
      display_name: string | null;
      phone_number: string | null;
      status: string | null;
      last_status_change_at: string | null;
    }>;
    const situacao = (c: { status: string | null }) =>
      STATUS_DA_CONEXAO[c.status ?? ""] ?? c.status ?? "desconhecida";

    // A tela Conexões é `minRole: "admin"` (lib/navigation/registry.ts). Quem
    // não é admin já vê o aviso de conexão caída no topo de toda tela, então
    // a SITUAÇÃO é dele; o nome e o final do número, não.
    if (!papelAoMenos(escopo, "admin")) {
      return {
        conexoes: linhas.map((c) => ({ situacao: situacao(c) })),
        detalhes: semPermissao("Conexões", "admin"),
      };
    }
    return {
      conexoes: linhas.map((c) => ({
        nome: c.display_name ? rotuloCurto(c.display_name) : "Sem nome",
        numero: mascararTelefone(c.phone_number),
        situacao: situacao(c),
        desde: dataHoraCurta(escopo.fuso, c.last_status_change_at),
      })),
      onde_ver: "Canais › Conexões",
    };
  },
};

// ─── a lista ─────────────────────────────────────────────────────────────────

export const FERRAMENTAS: readonly Ferramenta[] = [
  resumoConta,
  leadsPorEtapa,
  conversasAbertas,
  minhaAgenda,
  buscarContato,
  usoIaMes,
  statusConexoes,
];

/** O bloco `tools` da chamada ao OpenRouter. */
export function definicoesParaOModelo() {
  return FERRAMENTAS.map((f) => ({
    type: "function" as const,
    function: { name: f.nome, description: f.descricao, parameters: f.parametros },
  }));
}

/**
 * Executa UMA chamada de ferramenta pedida pelo modelo e devolve o texto que
 * volta para ele. Nunca lança: ferramenta desconhecida, argumento inválido ou
 * consulta com erro viram `{erro}` — o modelo explica ao usuário, e o detalhe
 * do banco não sai daqui.
 */
export async function executarFerramenta(
  nome: string,
  argumentosJson: string,
  ctx: ContextoDaFerramenta,
): Promise<string> {
  const ferramenta = FERRAMENTAS.find((f) => f.nome === nome);
  if (!ferramenta) return JSON.stringify({ erro: "ferramenta inexistente" });

  let args: unknown = {};
  try {
    args = argumentosJson.trim() ? JSON.parse(argumentosJson) : {};
  } catch {
    return JSON.stringify({ erro: "argumentos ilegíveis" });
  }

  try {
    const resultado = await ferramenta.executar(ctx, args);
    const texto = JSON.stringify(resultado);
    return texto.length > LIMITE_DE_CARACTERES
      ? JSON.stringify({ aviso: "resultado cortado", parcial: texto.slice(0, LIMITE_DE_CARACTERES) })
      : texto;
  } catch (e) {
    if (e instanceof z.ZodError) return JSON.stringify({ erro: "argumentos inválidos" });
    // A mensagem é sempre a mesma: o texto de um erro de banco (nome de
    // coluna, de policy) é arquitetura interna, e o modelo repetiria.
    return JSON.stringify({ erro: "não consegui consultar esse dado agora" });
  }
}
