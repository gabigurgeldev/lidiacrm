/**
 * OS HORÁRIOS LIVRES DE UMA ORGANIZAÇÃO — a coleta, num lugar só.
 *
 * ─── Por que este módulo existe ──────────────────────────────────────────────
 *
 * `horariosLivres` (`./horarios-livres`) é função PURA: recebe jornada, exceções,
 * ocupados e tipo já prontos. Alguém precisa buscar isso no banco, e essa coleta
 * nasceu inline no `GET` de `app/api/v1/agenda/horarios-livres/route.ts`.
 *
 * Só que a rota não é o único consumidor. As ferramentas MCP oferecem horário ao
 * cliente pela conversa, e elas não têm `NextRequest`, nem cookie, nem
 * `requireRole` — têm `organizationId` já resolvido e um client de service role.
 * Copiar a coleta para dentro da tool faria a IA e a tela responderem por regras
 * diferentes sobre o MESMO horário, que é o defeito que o cabeçalho de
 * `lib/mcp/tools/retencao.ts` descreve em voz alta: *"o sistema mentiria para um
 * dos dois"*. O sintoma seria a IA oferecendo um horário que a tela não mostra.
 *
 * Então a coleta mora aqui, e a rota passou a chamá-la. Mesmo caminho para os
 * dois, e o dia em que a regra mudar ela muda uma vez.
 *
 * ─── ⚠️ O CLIENT VEM DE FORA, E ISSO TEM PREÇO ───────────────────────────────
 *
 * A rota passa o client de SESSÃO (a RLS filtra sozinha). A ferramenta MCP passa
 * o ADMIN, que **bypassa a RLS**. Por isso TODA query aqui filtra
 * `organization_id` explicitamente — não é redundância com a RLS, é a única
 * proteção que existe no caminho do service role (anti-pattern nº 10 do
 * `CLAUDE.md`). Quem acrescentar query neste arquivo filtra também, sempre.
 *
 * ─── Recusa: dois textos, duas plateias ──────────────────────────────────────
 *
 * `motivoParaOperador` pode nomear campo e pessoa — quem lê é quem configura.
 * `motivoParaCliente` vai para o modelo e pode chegar ao cliente final: nada de
 * nome de campo, e ele diz o que fazer em seguida em vez de só negar. É a mesma
 * separação que `lerJornadaDoBanco` já faz, e pela mesma razão (DECISÃO 20).
 *
 * ─── Profissionais (migration 0245) ──────────────────────────────────────────
 *
 * A agenda deixou de ser "de um dono" e passou a ser de PROFISSIONAIS (com ou sem
 * login), e um tipo pode pedir duas (principal + apoio). A coleta por pessoa mora
 * em `./profissionais` e a combinação em `combinacoesLivres`; aqui fica a ordem
 * em que se decide QUEM é candidata — ver `candidatasDaConsulta`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { combinacoesLivres, type PessoaDaBusca } from "./horarios-livres";
import {
  carregarAgendasDosProfissionais,
  habilitacoesDoTipo,
  membrosRevogados,
  type AgendaDoProfissional,
  type HabilitacoesDoTipo,
} from "./profissionais";
import {
  AUTORES_DO_AGENDAMENTO,
  ORIGENS_DO_AGENDAMENTO,
  PAPEIS_DO_PROFISSIONAL,
  type AutorDoAgendamento,
  type OrigemDoAgendamento,
  type PapelDoProfissional,
  type SituacaoDaConexao,
  type SituacaoDoAgendamento,
} from "./tipos";
import type {
  AgendamentoListado,
  CodigoDeRecusaDaConsulta,
  ParametrosDaConsulta,
  ResultadoDaConsulta,
} from "./contrato";

/** Teto de dias por consulta: uma varredura de ano inteiro é erro de chamada, não pedido. */
export const MAXIMO_DE_DIAS = 62;

/**
 * Os tipos da consulta moram em `./contrato` (migration 0245) e são reexportados
 * daqui para quem já importava de `@/lib/agenda/consulta`.
 */
export type { AgendamentoListado, CodigoDeRecusaDaConsulta, ParametrosDaConsulta, ResultadoDaConsulta };

type Recusa = Extract<ResultadoDaConsulta, { ok: false }>;

const NAO_OFERECA =
  "Não ofereça horários e não diga que está sem vaga — avise que alguém da equipe confirma o horário.";

function erroInterno(motivo: string): Recusa {
  return {
    ok: false,
    codigo: "erro_interno",
    motivoParaOperador: motivo,
    motivoParaCliente: `Não consegui consultar a agenda agora. ${NAO_OFERECA}`,
  };
}

/** A linha de `calendar_event_types` que a consulta lê. */
interface LinhaDoTipo {
  id: string;
  name: string;
  is_active: boolean;
  duration_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  minimum_notice_minutes: number;
  slot_interval_minutes: number | null;
  booking_window_days: number;
  default_owner_user_id: string | null;
  professionals_required: number;
}

/**
 * Quem a consulta considera, e quem foi pedida por nome.
 *
 * `fixos` é a parte "pedida": recusa por jornada quebrada só derruba a consulta
 * inteira quando a quebrada é uma destas — a operação pediu ESSA pessoa, e
 * pular para outra seria responder outra pergunta.
 */
interface Candidatas {
  ids: string[];
  fixos: { principalId?: string; apoioId?: string };
}

/**
 * A ORDEM DOS CANDIDATOS — e cada degrau existe por um caso medido.
 *
 * 1. `profissionalIds` explícitos (ou `ownerUserId` legado, traduzido para o
 *    profissional do membro): a tela e a IA pediram alguém. Quando o tipo pede
 *    duas e só uma foi pedida, ela é a principal e a apoio sai das habilitadas.
 * 2. Senão, as habilitadas ATIVAS no tipo.
 * 3. Senão, o profissional do dono padrão do tipo — a instalação que ainda não
 *    mexeu em habilitação segue agendável como era antes da 0245.
 * 4. Senão, `sem_responsavel`: lista vazia aqui faria a tela dizer "nenhum
 *    horário disponível" para uma configuração incompleta, e o erro nomeado é o
 *    que leva alguém a corrigir.
 *
 * Em todos os degraus, quem SAIU da equipe (vínculo revogado) não é candidata —
 * nem pedida por nome, nem habilitada, nem dona padrão (`membrosRevogados`).
 */
async function candidatasDaConsulta(
  supabase: SupabaseClient,
  organizationId: string,
  tipo: LinhaDoTipo,
  params: ParametrosDaConsulta,
  necessarios: 1 | 2,
): Promise<Candidatas | Recusa> {
  const habilitadas = async (): Promise<HabilitacoesDoTipo | Recusa> => {
    try {
      return await habilitacoesDoTipo(supabase, organizationId, tipo.id);
    } catch (e) {
      return erroInterno(e instanceof Error ? e.message : String(e));
    }
  };

  let pedidas: string[] = [];
  if (params.profissionalIds && params.profissionalIds.length > 0) {
    pedidas = [...new Set(params.profissionalIds)];
  } else if (params.ownerUserId) {
    const { data, error } = await supabase
      .from("calendar_professionals")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("user_id", params.ownerUserId)
      .maybeSingle();
    if (error) return erroInterno(error.message);
    if (!data) {
      return {
        ok: false,
        codigo: "profissional_invalido",
        motivoParaOperador:
          "Este membro ainda não é profissional da agenda. Cadastre-o em Configurações → Agenda → Profissionais.",
        motivoParaCliente: `Essa pessoa não atende "${tipo.name}". Ofereça os horários sem escolher profissional.`,
      };
    }
    pedidas = [String(data.id)];
  }

  if (pedidas.length > 0) {
    if (pedidas.length > necessarios) {
      return {
        ok: false,
        codigo: "profissional_invalido",
        motivoParaOperador: `"${tipo.name}" pede ${necessarios} profissional(is), e foram escolhidas ${pedidas.length}.`,
        motivoParaCliente: `"${tipo.name}" é feito por ${necessarios === 1 ? "uma profissional" : "duas profissionais"}. Escolha de novo, ou ofereça os horários sem escolher profissional.`,
      };
    }

    // A pedida tem de ser desta organização, estar ativa e — se o tipo tem
    // habilitação — fazer este serviço. É a MESMA régua que o "marcar" aplica:
    // oferecer um horário com quem o marcar depois recusa é prometer em vão.
    const { data: linhas, error } = await supabase
      .from("calendar_professionals")
      .select("id, name, is_active, user_id")
      .eq("organization_id", organizationId)
      .in("id", pedidas);
    if (error) return erroInterno(error.message);
    const achadas = new Map((linhas ?? []).map((l) => [String(l.id), l]));

    let revogados: Set<string>;
    try {
      revogados = await membrosRevogados(
        supabase,
        organizationId,
        (linhas ?? []).map((l) => (l.user_id ? String(l.user_id) : null)),
      );
    } catch (e) {
      return erroInterno(e instanceof Error ? e.message : String(e));
    }

    const hab = await habilitadas();
    if ("ok" in hab) return hab;
    // A régua de "faz este serviço" é o conjunto CRU de habilitações — a mesma
    // que o marcar lê. Só com as ativas, um tipo cuja única habilitada saiu da
    // equipe viraria "qualquer uma serve" aqui e não lá.
    const idsHabilitados = hab.ids;

    for (const id of pedidas) {
      const linha = achadas.get(id);
      const recusa = (porque: string): Recusa => ({
        ok: false,
        codigo: "profissional_invalido",
        motivoParaOperador: porque,
        motivoParaCliente: `Essa profissional não está disponível para "${tipo.name}". Ofereça os horários sem escolher profissional, ou pergunte por outra.`,
      });
      if (!linha) return recusa(`Profissional ${id} não existe nesta organização.`);
      if (!linha.is_active) return recusa(`${String(linha.name)} está desativada.`);
      if (linha.user_id && revogados.has(String(linha.user_id))) {
        return recusa(`${String(linha.name)} não faz mais parte da equipe.`);
      }
      if (idsHabilitados.size > 0 && !idsHabilitados.has(id)) {
        return recusa(`${String(linha.name)} não está habilitada em "${tipo.name}".`);
      }
    }

    const [principalId, apoioId] = pedidas;
    if (necessarios === 1 || apoioId) {
      return { ids: pedidas, fixos: { principalId, apoioId } };
    }
    // Duas necessárias e uma pedida: ela é a principal, e a apoio vem das
    // habilitadas (ou, sem habilitação, do dono padrão).
    const apoios =
      hab.ativas.length > 0 ? hab.ativas.map((p) => p.id) : await idDoDonoPadrao(supabase, organizationId, tipo);
    if (!Array.isArray(apoios)) return apoios;
    return { ids: [...new Set([...pedidas, ...apoios])], fixos: { principalId } };
  }

  const hab = await habilitadas();
  if ("ok" in hab) return hab;
  if (hab.ativas.length > 0) return { ids: hab.ativas.map((p) => p.id), fixos: {} };

  const doDono = await idDoDonoPadrao(supabase, organizationId, tipo);
  if (!Array.isArray(doDono)) return doDono;
  if (doDono.length > 0) return { ids: doDono, fixos: {} };

  return {
    ok: false,
    codigo: "sem_responsavel",
    motivoParaOperador: `"${tipo.name}" não tem profissional habilitada nem responsável definido, e sem ninguém não há agenda para consultar.`,
    motivoParaCliente: `Ainda não há quem atenda "${tipo.name}". ${NAO_OFERECA}`,
  };
}

/**
 * O profissional ATIVO do dono padrão do tipo, como lista (vazia se não há).
 * Dono padrão que saiu da equipe não responde por nada: vazio, e a consulta cai
 * em `sem_responsavel` — que é o que leva alguém a escolher outro.
 */
async function idDoDonoPadrao(
  supabase: SupabaseClient,
  organizationId: string,
  tipo: LinhaDoTipo,
): Promise<string[] | Recusa> {
  if (!tipo.default_owner_user_id) return [];
  const { data, error } = await supabase
    .from("calendar_professionals")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", tipo.default_owner_user_id)
    .eq("is_active", true)
    .maybeSingle();
  if (error) return erroInterno(error.message);
  if (!data) return [];
  try {
    const revogados = await membrosRevogados(supabase, organizationId, [tipo.default_owner_user_id]);
    if (revogados.has(tipo.default_owner_user_id)) return [];
  } catch (e) {
    return erroInterno(e instanceof Error ? e.message : String(e));
  }
  return [String(data.id)];
}

export async function horariosLivresDaOrg(
  supabase: SupabaseClient,
  organizationId: string,
  params: ParametrosDaConsulta,
): Promise<ResultadoDaConsulta> {
  const { data: tipoRaw, error: erroTipo } = await supabase
    .from("calendar_event_types")
    .select(
      "id, name, is_active, duration_minutes, buffer_before_minutes, buffer_after_minutes, minimum_notice_minutes, slot_interval_minutes, booking_window_days, default_owner_user_id, professionals_required",
    )
    .eq("organization_id", organizationId)
    .eq(params.eventTypeSlug ? "slug" : "id", params.eventTypeSlug ?? params.eventTypeId ?? "")
    .maybeSingle();

  if (erroTipo) return erroInterno(erroTipo.message);
  const tipo = tipoRaw as LinhaDoTipo | null;
  if (!tipo) {
    return {
      ok: false,
      codigo: "tipo_desconhecido",
      motivoParaOperador: "Tipo de agendamento não encontrado.",
      // Devolve o que foi pedido: sem isso o modelo não sabe QUAL nome errou, e
      // a recusa que não ensina faz ele tentar de novo igual.
      motivoParaCliente:
        `Não existe atendimento chamado "${params.eventTypeSlug ?? params.eventTypeId ?? ""}". ` +
        "Pergunte à pessoa que tipo de atendimento ela quer e use um dos tipos que a organização oferece.",
    };
  }
  if (!tipo.is_active) {
    return {
      ok: false,
      codigo: "tipo_desativado",
      motivoParaOperador: `"${tipo.name}" está desativado.`,
      motivoParaCliente: `"${tipo.name}" não está sendo agendado no momento. ${NAO_OFERECA}`,
    };
  }

  const necessarios: 1 | 2 = tipo.professionals_required === 2 ? 2 : 1;

  const candidatas = await candidatasDaConsulta(supabase, organizationId, tipo, params, necessarios);
  if ("ok" in candidatas) return candidatas;

  const coleta = await carregarAgendasDosProfissionais(supabase, organizationId, candidatas.ids, {
    de: params.de,
    ate: params.ate,
    ignorarAgendamentoId: params.ignorarAgendamentoId,
  });
  if (!coleta.ok) return erroInterno(coleta.motivoParaOperador);

  // Na ordem de exibição (position, nome) — a coleta já devolve o mapa nela.
  const agendas = [...coleta.agendas.values()];
  const pedidas = new Set([candidatas.fixos.principalId, candidatas.fixos.apoioId].filter(Boolean));

  // ⚠️ JORNADA QUEBRADA DE UMA NÃO DERRUBA AS OUTRAS.
  //
  // Com um dono só, jornada corrompida era recusa da consulta inteira — e
  // estava certo, não havia mais ninguém. Com seis profissionais, a mesma regra
  // faria uma esteticista sem horário cadastrado tirar a agenda da clínica do
  // ar. Ela é PULADA e reportada em `profissionaisComProblema` (falha aberta na
  // informação: a tela diz quem está fora e por quê), e a consulta só falha
  // quando não sobra ninguém — ou quando a quebrada foi PEDIDA por nome.
  const saudaveis: (AgendaDoProfissional & { leitura: Extract<AgendaDoProfissional["leitura"], { ok: true }> })[] = [];
  const problemas: { id: string; nome: string; motivoParaOperador: string; motivoParaCliente: string }[] = [];
  for (const a of agendas) {
    if (a.leitura.ok) {
      saudaveis.push(a as (typeof saudaveis)[number]);
      continue;
    }
    // `leitura.motivoParaOperador` já vem como fragmento pensado para encaixar
    // aqui ("ainda não foi configurada. Configure em…" ou "está mal
    // configurada: <motivo>") — ver `lerJornadaDoBanco`. Duas recusas
    // diferentes não podem virar a mesma frase.
    problemas.push({
      id: a.profissional.id,
      nome: a.profissional.nome,
      motivoParaOperador: `A jornada de ${a.profissional.nome} ${a.leitura.motivoParaOperador}`,
      motivoParaCliente: a.leitura.motivoParaCliente,
    });
  }

  // Pedida que não voltou da coleta: sumiu entre a validação e a leitura.
  for (const id of pedidas) {
    if (!coleta.agendas.has(String(id))) {
      return {
        ok: false,
        codigo: "profissional_invalido",
        motivoParaOperador: `Profissional ${String(id)} não existe nesta organização.`,
        motivoParaCliente: `Essa profissional não está disponível para "${tipo.name}". Ofereça os horários sem escolher profissional.`,
      };
    }
  }

  const pedidaQuebrada = problemas.find((p) => pedidas.has(p.id));
  const quebradaQueImpede =
    pedidaQuebrada ?? (saudaveis.length < necessarios ? problemas[0] : undefined);
  if (quebradaQueImpede) {
    return {
      ok: false,
      codigo: "jornada_mal_configurada",
      motivoParaOperador: quebradaQueImpede.motivoParaOperador,
      motivoParaCliente: `${quebradaQueImpede.motivoParaCliente} ${NAO_OFERECA}`,
    };
  }
  if (saudaveis.length < necessarios) {
    return {
      ok: false,
      codigo: "profissionais_insuficientes",
      motivoParaOperador: `"${tipo.name}" pede ${necessarios} profissionais, e só ${saudaveis.length} está(ão) habilitada(s) e ativa(s).`,
      motivoParaCliente: `"${tipo.name}" ainda não pode ser agendado. ${NAO_OFERECA}`,
    };
  }

  const pessoas: PessoaDaBusca[] = saudaveis.map((a) => ({
    id: a.profissional.id,
    jornada: a.leitura.jornada,
    excecoes: a.excecoes,
    ocupados: a.ocupados,
  }));

  const slots = combinacoesLivres({
    pessoas,
    necessarios,
    fixos: candidatas.fixos,
    tipo: {
      duracaoMin: tipo.duration_minutes,
      bufferAntesMin: tipo.buffer_before_minutes,
      bufferDepoisMin: tipo.buffer_after_minutes,
      avisoMinimoMin: tipo.minimum_notice_minutes,
      intervaloMin: tipo.slot_interval_minutes,
      janelaDias: tipo.booking_window_days,
    },
    de: params.de,
    ate: params.ate,
    agora: params.agora,
  });

  // O fuso da regra é o de quem DÁ a grade: a principal pedida, ou a primeira
  // na ordem. Profissionais em fusos diferentes são possíveis e raros; a tela
  // exibe cada horário no fuso de apresentação de qualquer jeito.
  const daGrade =
    saudaveis.find((a) => a.profissional.id === candidatas.fixos.principalId) ?? saudaveis[0]!;

  // "Não publiquei" vs "não tenho vaga" (DECISÃO 1.1), agora contando gente: o
  // horário só pode existir se houver quem publicou em número suficiente — e,
  // com principal pedida, se ELA publicou.
  const publicaram = saudaveis.filter((a) => a.leitura.publicouHorarios);
  const publicouHorarios =
    publicaram.length >= necessarios &&
    (!candidatas.fixos.principalId || publicaram.some((a) => a.profissional.id === candidatas.fixos.principalId));

  const fontesDefasadas = new Set<SituacaoDaConexao>();
  for (const a of saudaveis) for (const f of a.fontesDefasadas) fontesDefasadas.add(f);

  return {
    ok: true,
    slots,
    profissionais: saudaveis.map((a) => a.profissional),
    profissionaisNecessarios: necessarios,
    fusoDaRegra: daGrade.leitura.jornada.timezone,
    publicouHorarios,
    fusoSuposto: saudaveis.some((a) => a.leitura.fusoSuposto),
    fontesDefasadas: [...fontesDefasadas],
    agendaExternaNuncaLida: saudaveis.some((a) => a.agendaExternaNuncaLida),
    profissionaisComProblema: problemas.map(({ id, nome, motivoParaOperador }) => ({
      id,
      nome,
      motivoParaOperador,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// A LISTAGEM — "o que este cliente tem marcado?" e "como está o dia da equipe?"
//
// Mesma razão de existir da coleta acima: a IA lista compromissos pela conversa e
// a tela lista pelo painel. Duas leituras dariam respostas diferentes sobre o mesmo
// dia — e aqui o erro é pior que na consulta de horário livre, porque listar é o
// que o agente faz ANTES de dizer ao cliente "você já tem consulta marcada".
//
// ⚠️ O VÍNCULO COM O LEAD É POLIMÓRFICO (DECISÃO 6): não há `lead_id` em
// `calendar_appointments` — o ponteiro é `crm_lead_links` com
// `target_kind='appointment'`. Filtrar por lead custa uma consulta a mais, e é o
// preço de não ter duplicado a FK. O filtro por PROFISSIONAL segue o mesmo
// desenho, pela mesma razão: quem atende mora em `calendar_appointment_professionals`.
// ─────────────────────────────────────────────────────────────────────────────

export interface ParametrosDaLista {
  contactId?: string | null;
  /** Resolvido por `crm_lead_links` — ver o aviso acima. */
  leadId?: string | null;
  /**
   * Resolvido por `calendar_appointment_professionals`: pega o que ela atende
   * como principal E como apoio. `ownerUserId` (abaixo) só enxerga a principal
   * com login — é o filtro legado.
   */
  professionalId?: string | null;
  /**
   * `YYYY-MM-DD`; filtra o dia inteiro.
   *
   * ⚠️ O CORTE É EM UTC, e para fuso negativo isso NÃO é o dia do usuário.
   * Medido para `America/Sao_Paulo`, dia 12: o filtro pega de 11/03 21:00 até
   * 12/03 20:59 na parede de quem olha — três horas do dia ANTERIOR entram, e as
   * três últimas do dia pedido ficam de fora. Um compromisso das 22h some da
   * lista do próprio dia.
   *
   * Quem precisa de recorte exato usa `de`/`ate`, que são INSTANTES e não têm
   * ambiguidade. `dia` fica para quem só quer um recorte grosseiro — e agora
   * sabe o que está pedindo.
   */
  dia?: string | null;
  /**
   * Recorte por PERÍODO, em instantes ISO. É o que a grade da tela usa: ela é
   * semanal e mensal (`startOfWeek`, seis semanas no mês), então `dia` não a
   * serve — e sete requisições para desenhar uma semana seria a alternativa.
   *
   * Instante em vez de data resolve o fuso na origem: quem chama calcula os
   * limites no fuso de APRESENTAÇÃO e manda o instante, sem esta função
   * precisar adivinhar em que fuso o "dia" foi pedido.
   */
  de?: string | null;
  ate?: string | null;
  ownerUserId?: string | null;
  situacao?: SituacaoDoAgendamento | null;
  limite: number;
  /**
   * Escopo de quem pergunta (migration 0249). Atendente e viewer veem só a
   * própria agenda: o que são donos, em que participam ou que criaram. A RLS já
   * recorta isso no client de sessão; o filtro aqui é a defesa que sobra se uma
   * policy for afrouxada — e o que vale quando o client é o admin.
   * `null`/ausente = a organização inteira (gerente+).
   */
  restritoA?: { userId: string } | null;
}

export type ResultadoDaLista =
  | { ok: true; agendamentos: AgendamentoListado[] }
  | { ok: false; codigo: "erro_interno" | "sem_alvo"; motivoParaOperador: string; motivoParaCliente: string };

/** O embed do PostgREST vem objeto ou array conforme o gerador de tipos; aceite os dois. */
function nomeDoContato(
  c: { name: string | null; display_name: string | null } | { name: string | null; display_name: string | null }[] | null | undefined,
): string | null {
  const alvo = Array.isArray(c) ? c[0] : c;
  return alvo?.name ?? alvo?.display_name ?? null;
}

/**
 * `source` e `created_by_kind` têm CHECK no banco com estes mesmos
 * vocabulários; o estreitamento existe para o compilador, não para o dado. Valor
 * fora da lista (um clone com CHECK mais largo) vira o mais neutro de cada um —
 * nunca "IA", que acenderia selo de autoria que ninguém conferiu.
 */
export function origemDe(valor: unknown): OrigemDoAgendamento {
  return (ORIGENS_DO_AGENDAMENTO as readonly string[]).includes(String(valor))
    ? (String(valor) as OrigemDoAgendamento)
    : "ui";
}

export function autorDe(valor: unknown): AutorDoAgendamento {
  return (AUTORES_DO_AGENDAMENTO as readonly string[]).includes(String(valor))
    ? (String(valor) as AutorDoAgendamento)
    : "system";
}

export function papelDe(valor: unknown): PapelDoProfissional {
  return (PAPEIS_DO_PROFISSIONAL as readonly string[]).includes(String(valor))
    ? (String(valor) as PapelDoProfissional)
    : "apoio";
}

/** Principal primeiro — é a ordem que a tela usa para a cor e o card. */
function porPapel<T extends { papel: PapelDoProfissional }>(a: T, b: T): number {
  return PAPEIS_DO_PROFISSIONAL.indexOf(a.papel) - PAPEIS_DO_PROFISSIONAL.indexOf(b.papel);
}

const NAO_LISTEI = "Não consegui consultar os compromissos agora. Avise que alguém da equipe confirma.";

/**
 * O filtro PostgREST "a agenda desta pessoa": dona OU quem criou OU participa
 * como profissional com login. É a mesma regra de `fn_can_view_appointment`
 * (0249), dita em filtro para valer também fora da RLS.
 *
 * A participação sai de `calendar_appointment_professionals` recortada pela
 * mesma janela da listagem, para a lista de ids não crescer com o histórico.
 */
async function escopoDaPessoa(
  supabase: SupabaseClient,
  organizationId: string,
  userId: string,
  params: Pick<ParametrosDaLista, "de" | "ate">,
): Promise<{ ok: true; filtro: string } | { ok: false; motivo: string }> {
  const { data: minhas, error: erroMinhas } = await supabase
    .from("calendar_professionals")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId);
  if (erroMinhas) return { ok: false, motivo: erroMinhas.message };

  let participo: string[] = [];
  const profissionais = (minhas ?? []).map((p) => String(p.id));
  if (profissionais.length > 0) {
    let q = supabase
      .from("calendar_appointment_professionals")
      .select("appointment_id")
      .eq("organization_id", organizationId)
      .in("professional_id", profissionais)
      .limit(1000);
    if (params.de && params.ate) q = q.lt("starts_at", params.ate).gt("ends_at", params.de);
    const { data, error } = await q;
    if (error) return { ok: false, motivo: error.message };
    participo = [...new Set((data ?? []).map((l) => String(l.appointment_id)))];
  }

  const partes = [`owner_user_id.eq.${userId}`, `created_by_user_id.eq.${userId}`];
  if (participo.length > 0) partes.push(`id.in.(${participo.join(",")})`);
  return { ok: true, filtro: partes.join(",") };
}

export async function listaAgendamentos(
  supabase: SupabaseClient,
  organizationId: string,
  params: ParametrosDaLista,
): Promise<ResultadoDaLista> {
  const temAlvo = Boolean(
    params.contactId ||
      params.leadId ||
      params.professionalId ||
      params.dia ||
      params.ownerUserId ||
      (params.de && params.ate),
  );
  if (!temAlvo) {
    // Sem recorte, isto varreria a agenda inteira da organização. Recusa com ensino,
    // não lista vazia: vazio faria o modelo concluir que não há nada marcado.
    return {
      ok: false,
      codigo: "sem_alvo",
      motivoParaOperador:
        "listagem sem recorte: informe contato, lead, profissional, dia, período (de+ate) ou responsável.",
      motivoParaCliente:
        "Preciso saber de quem ou de que dia. Pergunte de qual cliente ou de qual data você quer ver os compromissos.",
    };
  }

  const falha = (motivo: string): ResultadoDaLista => ({
    ok: false,
    codigo: "erro_interno",
    motivoParaOperador: motivo,
    motivoParaCliente: NAO_LISTEI,
  });

  let idsPorLead: string[] | null = null;
  if (params.leadId) {
    // DECISÃO 6: o vínculo é polimórfico. `target_kind='appointment'` já está no CHECK
    // de `crm_lead_links` desde antes desta entrega.
    const { data, error } = await supabase
      .from("crm_lead_links")
      .select("target_id")
      .eq("organization_id", organizationId)
      .eq("lead_id", params.leadId)
      .eq("target_kind", "appointment");
    if (error) return falha(error.message);
    idsPorLead = (data ?? []).map((l) => String(l.target_id));
    // Lead sem nenhum vínculo: lista vazia é a resposta CERTA aqui — a pergunta era
    // "o que este negócio tem marcado?" e a resposta é "nada". Diferente de não saber.
    if (idsPorLead.length === 0) return { ok: true, agendamentos: [] };
  }

  let idsPorProfissional: string[] | null = null;
  if (params.professionalId) {
    const { data, error } = await supabase
      .from("calendar_appointment_professionals")
      .select("appointment_id")
      .eq("organization_id", organizationId)
      .eq("professional_id", params.professionalId);
    if (error) return falha(error.message);
    idsPorProfissional = (data ?? []).map((l) => String(l.appointment_id));
    if (idsPorProfissional.length === 0) return { ok: true, agendamentos: [] };
  }

  // Os dois filtros por vínculo juntos são INTERSEÇÃO: "o que a Ana atende para
  // este negócio". Interseção vazia é resposta certa, e não consulta a mais.
  let idsFiltrados: string[] | null = idsPorLead ?? idsPorProfissional;
  if (idsPorLead && idsPorProfissional) {
    const daProfissional = new Set(idsPorProfissional);
    idsFiltrados = idsPorLead.filter((id) => daProfissional.has(id));
    if (idsFiltrados.length === 0) return { ok: true, agendamentos: [] };
  }

  let q = supabase
    .from("calendar_appointments")
    .select(
      "id, title, starts_at, ends_at, time_zone, status, owner_user_id, contact_id, event_type_id, source, created_by_kind, conversation_id, contacts(name, display_name)",
    )
    .eq("organization_id", organizationId)
    .order("starts_at", { ascending: true })
    .limit(params.limite);

  if (idsFiltrados) q = q.in("id", idsFiltrados);
  if (params.restritoA) {
    const escopo = await escopoDaPessoa(supabase, organizationId, params.restritoA.userId, params);
    if (!escopo.ok) return falha(escopo.motivo);
    q = q.or(escopo.filtro);
  }
  if (params.contactId) q = q.eq("contact_id", params.contactId);
  if (params.ownerUserId) q = q.eq("owner_user_id", params.ownerUserId);
  if (params.situacao) q = q.eq("status", params.situacao);
  if (params.dia) {
    q = q.gte("starts_at", `${params.dia}T00:00:00Z`).lt("starts_at", `${params.dia}T23:59:59.999Z`);
  }
  // O período vence o dia quando os dois vêm: quem manda instante está pedindo
  // recorte exato, e sobrepor o corte grosseiro do `dia` devolveria a interseção
  // — que não é o que nenhum dos dois pediu.
  if (params.de && params.ate) {
    q = q.gte("starts_at", params.de).lt("starts_at", params.ate);
  } else if (!params.dia) {
    // ⚠️ SEM RECORTE DE TEMPO, O PISO É AGORA — e sem este `else if` a listagem
    // respondia a pergunta errada.
    //
    // A query ordena `ascending` e corta em `limite`. Sem piso, um contato com
    // mais compromissos que o limite recebia os MAIS ANTIGOS, e o de amanhã
    // ficava de fora. Medido no caminho real: 60 linhas no banco, limite 20, e a
    // consulta recém-marcada não aparecia na listagem do próprio contato.
    //
    // E é a pergunta que a ferramenta MCP declara responder: "USE ANTES DE
    // MARCAR: cliente que já tem consulta marcada não deve receber oferta de
    // horário como se não tivesse". Consulta do ano passado não responde isso.
    // A combinação limite + ordem derrotava a instrução que a própria ferramenta
    // dá ao modelo.
    //
    // Quem quiser o passado pede explicitamente por `de`/`ate` ou por `dia` —
    // os dois caminhos continuam intactos.
    q = q.gte("starts_at", new Date().toISOString());
  }

  const { data, error } = await q;
  if (error) return falha(error.message);
  const linhas = data ?? [];

  // Quem atende cada um — UMA consulta para a página inteira, não uma por linha.
  const participantes = new Map<string, { id: string; papel: PapelDoProfissional }[]>();
  if (linhas.length > 0) {
    const { data: parts, error: erroParts } = await supabase
      .from("calendar_appointment_professionals")
      .select("appointment_id, professional_id, role")
      .eq("organization_id", organizationId)
      .in(
        "appointment_id",
        linhas.map((l) => String(l.id)),
      );
    if (erroParts) return falha(erroParts.message);
    for (const p of parts ?? []) {
      const chave = String(p.appointment_id);
      const lista = participantes.get(chave) ?? [];
      lista.push({ id: String(p.professional_id), papel: papelDe(p.role) });
      participantes.set(chave, lista);
    }
  }

  return {
    ok: true,
    agendamentos: linhas.map((l) => ({
      id: String(l.id),
      titulo: String(l.title),
      iniciaEm: String(l.starts_at),
      terminaEm: String(l.ends_at),
      fuso: String(l.time_zone),
      situacao: String(l.status),
      donoId: l.owner_user_id ? String(l.owner_user_id) : null,
      contatoId: l.contact_id ? String(l.contact_id) : null,
      // O ID sozinho não serve a nenhum dos dois consumidores: a grade precisa do
      // nome para dizer "com quem", e o AGENTE recebia um uuid cru onde devia
      // dizer "você já tem consulta marcada, Maria". Mesma coluna que a tela do
      // produto lê, mesmo precedente de `name` antes de `display_name`.
      contatoNome: nomeDoContato(l.contacts),
      profissionais: (participantes.get(String(l.id)) ?? []).sort(porPapel),
      eventTypeId: l.event_type_id ? String(l.event_type_id) : null,
      // A origem é a do BANCO. O hook da tela cravava "ui" para tudo, e o selo
      // "marcado pela IA" nunca acendia — o dado existia desde a 0177 e não
      // entrava no select.
      origem: origemDe(l.source),
      autor: autorDe(l.created_by_kind),
      conversaId: l.conversation_id ? String(l.conversation_id) : null,
    })),
  };
}


/**
 * O id do tipo a partir do SLUG — a ponte entre o que o modelo sabe e o que o
 * handler pede.
 *
 * `MarcarInput.event_type_id` é uuid, e o modelo não tem uuid: o slug existe
 * justamente para "dar à IA um handle que ela não alucina". A tradução acontece
 * aqui, uma vez, em vez de cada tool inventar a sua.
 */
export async function idDoTipoPorSlug(
  supabase: SupabaseClient,
  organizationId: string,
  slug: string,
): Promise<{ id: string; nome: string } | null> {
  const { data } = await supabase
    .from("calendar_event_types")
    .select("id, name")
    .eq("organization_id", organizationId)
    .eq("slug", slug)
    .maybeSingle();
  return data ? { id: String(data.id), nome: String(data.name) } : null;
}
