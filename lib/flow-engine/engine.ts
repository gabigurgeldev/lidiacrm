/**
 * Flow Engine — o tick do worker.
 *
 * Orquestra o I/O em volta das decisões PURAS dos nós: reclama execuções
 * vencidas, carrega o grafo fixado na versão, monta o contexto, chama
 * `execute`, persiste o que voltou.
 *
 * `FlowAdminClient` é uma interface estreita e não `SupabaseClient` pelo mesmo
 * motivo que `lib/followup/engine.ts:87`: assim este arquivo roda contra o
 * harness de Postgres cru dos invariantes (onde não há PostgREST) e contra a
 * produção, sem duas versões da lógica.
 */

import { analisarGrafo, arestaDoRamo, flowGraphSchema, noPorId, type FlowGraph } from "./graph-schema";
import { exigirNo } from "./registry";
import { interpolar } from "./variaveis";
import type {
  EscopoDeVariaveis,
  EsperaEmCurso,
  FatosDaExecucao,
  FlowExecutionContext,
  NodeExecutionResult,
  PortaDeAvisos,
  PortaDeCanal,
  PortaDoCrm,
  PortaDeRoteamento,
} from "./types";

/**
 * Quantos nós um tick percorre numa mesma execução antes de devolver o controle.
 *
 * Não é `MAX_STEPS` do fluxo — é o teto por RODADA. Sem ele, avançar um nó por
 * tick faria um fluxo de 8 blocos levar 8 minutos (o cron roda 1×/min) para
 * fazer o que é instantâneo. Com ele, uma execução caminha até bater numa
 * espera, num fim, ou neste teto.
 */
const PASSOS_POR_TICK = 20;

/** Teto ABSOLUTO de passos de uma execução. Cinto contra grafo patológico. */
export const PASSOS_MAXIMOS = 200;

/** Escada de espera entre tentativas, indexada por `attempts - 1`. 30s..1h. */
export const BACKOFF_MS = [30_000, 60_000, 300_000, 900_000, 3_600_000] as const;

const LEASE_SEGUNDOS = 120;
const LIMITE_DO_LOTE = 20;
const TAMANHO_MAXIMO_DO_ERRO = 300;

export interface FlowExecutionRow {
  id: string;
  organization_id: string;
  flow_id: string;
  version_id: string;
  status: string;
  current_node_id: string;
  next_eval_at: string | null;
  attempts: number;
  max_attempts: number;
  steps_taken: number;
  context: Record<string, unknown>;
  lead_id: string | null;
  contact_id: string | null;
  conversation_id: string | null;
  started_at: string;
}

export interface FlowExecutionPatch {
  status?: string;
  current_node_id?: string;
  next_eval_at?: string | null;
  claimed_until?: string | null;
  attempts?: number;
  last_error?: string | null;
  steps_taken?: number;
  outcome?: string | null;
  context?: Record<string, unknown>;
  completed_at?: string | null;
  updated_at?: string;
}

export interface FlowAdminClient {
  reclamarVencidas(limite: number, leaseSegundos: number): Promise<FlowExecutionRow[]>;
  carregarGrafo(orgId: string, versionId: string): Promise<unknown | null>;
  carregarFatos(orgId: string, exec: FlowExecutionRow): Promise<FatosDaExecucao>;
  /** A espera em curso NESTE nó, lida do log de passos. `null` = primeira visita. */
  esperaEmCurso(executionId: string, nodeId: string): Promise<EsperaEmCurso | null>;
  /** `inserted:false` = a chave de idempotência já existia (replay). */
  registrarPasso(evento: {
    organization_id: string;
    execution_id: string;
    node_id: string | null;
    event_type: string;
    payload: Record<string, unknown>;
    idempotency_key: string;
  }): Promise<{ inserted: boolean }>;
  atualizarExecucao(id: string, orgId: string, patch: FlowExecutionPatch): Promise<void>;
  nomeDoFluxo(orgId: string, flowId: string): Promise<string | null>;
  abrirAvisoDeMorte(item: {
    organization_id: string;
    titulo: string;
    corpo: string;
    refId: string;
  }): Promise<void>;
}

export interface PortasDaExecucao {
  crm: PortaDoCrm;
  roteamento: PortaDeRoteamento;
  canal: PortaDeCanal;
  avisos: PortaDeAvisos;
}

export interface TickDeps {
  db: FlowAdminClient;
  relogio: () => Date;
  /** Monta as portas com o escopo daquela execução (org, lead, conversa). */
  portas: (exec: FlowExecutionRow) => PortasDaExecucao;
}

export interface TickSummary {
  /**
   * Separa "o claim falhou" de "não havia nada vencido". Os dois produzem
   * `reclamadas: 0`, e sem esta marca o segundo esconde o primeiro para sempre
   * — a lição que `TickSummary.claim_falhou` do follow-up já paga.
   */
  claim_falhou?: boolean;
  reclamadas: number;
  avancadas: number;
  esperando: number;
  concluidas: number;
  falhadas: number;
  mortas: number;
}

function mensagemDeErro(err: unknown): string {
  const cru = err instanceof Error ? err.message : String(err);
  return cru.slice(0, TAMANHO_MAXIMO_DO_ERRO);
}

function backoffAte(agora: Date, tentativas: number): Date {
  const i = Math.min(Math.max(tentativas - 1, 0), BACKOFF_MS.length - 1);
  return new Date(agora.getTime() + BACKOFF_MS[i]!);
}

// ─────────────────────────────── o tick ──────────────────────────────────────

export async function rodarTickDeFluxos(deps: TickDeps): Promise<TickSummary> {
  const resumo: TickSummary = {
    reclamadas: 0,
    avancadas: 0,
    esperando: 0,
    concluidas: 0,
    falhadas: 0,
    mortas: 0,
  };

  let lote: FlowExecutionRow[];
  try {
    lote = await deps.db.reclamarVencidas(LIMITE_DO_LOTE, LEASE_SEGUNDOS);
  } catch {
    resumo.claim_falhou = true;
    return resumo;
  }
  resumo.reclamadas = lote.length;

  for (const execucao of lote) {
    try {
      await caminhar(execucao, deps, resumo);
    } catch (err) {
      // Erro fora do nó (grafo ilegível, porta que explodiu) conta como
      // tentativa, com backoff. Não pode derrubar o lote inteiro: uma execução
      // podre deixaria as outras 19 sem tick.
      await falhar(execucao, deps, resumo, mensagemDeErro(err));
    }
  }

  return resumo;
}

/** Percorre a execução até bater numa espera, num fim, ou no teto do tick. */
async function caminhar(
  execucao: FlowExecutionRow,
  deps: TickDeps,
  resumo: TickSummary,
): Promise<void> {
  const agora = deps.relogio();
  const bruto = await deps.db.carregarGrafo(execucao.organization_id, execucao.version_id);
  if (bruto === null) {
    await matar(execucao, deps, resumo, "versao_do_fluxo_sumiu");
    return;
  }
  const parsed = flowGraphSchema.safeParse(bruto);
  if (!parsed.success) {
    // Versão publicada que não parseia é defeito de dado, não de execução:
    // repetir não conserta, e cada tentativa custaria um minuto do worker.
    await matar(execucao, deps, resumo, "grafo_publicado_ilegivel");
    return;
  }
  const grafo: FlowGraph = parsed.data;
  const analisado = analisarGrafo(grafo);
  if (analisado.erros.length > 0) {
    await matar(execucao, deps, resumo, `grafo_invalido:${analisado.erros[0]!.codigo}`);
    return;
  }

  let fatos = await deps.db.carregarFatos(execucao.organization_id, execucao);
  const portas = deps.portas(execucao);

  let nodeId = execucao.current_node_id;
  let contexto = { ...execucao.context };
  let passos = execucao.steps_taken;

  for (let doTick = 0; doTick < PASSOS_POR_TICK; doTick += 1) {
    if (passos >= PASSOS_MAXIMOS) {
      await matar(execucao, deps, resumo, "passos_demais", { current_node_id: nodeId, context: contexto });
      return;
    }

    const no = noPorId(analisado.nos, nodeId);
    if (no === null) {
      // O nó saiu do grafo entre a publicação e agora. Não deveria acontecer
      // (a versão é imutável), então é sinal de dado corrompido, não de corrida.
      await matar(execucao, deps, resumo, `no_inexistente:${nodeId}`, { context: contexto });
      return;
    }

    const espera = await deps.db.esperaEmCurso(execucao.id, nodeId);
    const escopo: EscopoDeVariaveis = {
      lead: fatos.lead,
      contact: fatos.contact,
      assigned_user: fatos.assigned_user,
      vars: contexto,
      execution: { id: execucao.id, started_at: execucao.started_at, steps_taken: passos },
    };
    const ctx: FlowExecutionContext = {
      organizationId: execucao.organization_id,
      executionId: execucao.id,
      nodeId,
      fatos,
      escopo,
      esperaEmCurso: espera,
      crm: portas.crm,
      roteamento: portas.roteamento,
      canal: portas.canal,
      avisos: portas.avisos,
      agora: deps.relogio,
      render: (texto) => interpolar(texto, escopo).texto,
    };

    let resultado: NodeExecutionResult;
    try {
      resultado = await exigirNo(no.type).execute(ctx, no.config as never);
    } catch (err) {
      await falhar(execucao, deps, resumo, `${no.type}: ${mensagemDeErro(err)}`, {
        current_node_id: nodeId,
        context: contexto,
      });
      return;
    }

    if (resultado.kind === "advance") {
      contexto = { ...contexto, ...(resultado.vars ?? {}) };
      passos += 1;
      const aresta = arestaDoRamo(analisado.arestas, nodeId, resultado.branch_id);
      await deps.db.registrarPasso({
        organization_id: execucao.organization_id,
        execution_id: execucao.id,
        node_id: nodeId,
        event_type: "no_avancou",
        payload: { ramo: resultado.branch_id, proximo: aresta?.target ?? null },
        // A chave inclui o número do passo: o MESMO nó pode ser visitado de novo
        // (a redistribuição volta ao rodízio), e uma chave só com o id do nó faria
        // a segunda visita ser engolida como replay.
        idempotency_key: `${nodeId}:avanco:${passos}`,
      });

      if (aresta === null) {
        // Ramo sem saída é o fim daquele caminho, e foi desenhado assim de
        // propósito (a validação de publicação só exige saída em ramo de REGRA).
        await concluir(execucao, deps, resumo, `sem_saida:${resultado.branch_id}`, {
          current_node_id: nodeId,
          context: contexto,
          steps_taken: passos,
        });
        return;
      }
      // Recarrega os fatos quando o nó DECLAROU que mexeu no CRM. Sem isto, o
      // `whatsapp.notify_user` logo depois do rodízio lia `assigned_user` como
      // `null` — o vendedor era escolhido e nunca avisado, e nada acusava.
      if (exigirNo(no.type).mutaCrm === true) {
        fatos = await deps.db.carregarFatos(execucao.organization_id, execucao);
      }

      nodeId = aresta.target;
      resumo.avancadas += 1;
      continue;
    }

    if (resultado.kind === "wait") {
      await deps.db.registrarPasso({
        organization_id: execucao.organization_id,
        execution_id: execucao.id,
        node_id: nodeId,
        event_type: "espera_iniciada",
        payload: {
          ate: resultado.next_eval_at.toISOString(),
          motivo: resultado.motivo ?? null,
        },
        idempotency_key: `${nodeId}:espera:${passos}`,
      });
      await deps.db.atualizarExecucao(execucao.id, execucao.organization_id, {
        status: "waiting",
        current_node_id: nodeId,
        next_eval_at: resultado.next_eval_at.toISOString(),
        claimed_until: null,
        attempts: 0,
        last_error: null,
        steps_taken: passos,
        context: contexto,
        updated_at: agora.toISOString(),
      });
      resumo.esperando += 1;
      return;
    }

    if (resultado.kind === "complete") {
      contexto = { ...contexto, ...(resultado.vars ?? {}) };
      await concluir(execucao, deps, resumo, resultado.outcome, {
        current_node_id: nodeId,
        context: contexto,
        steps_taken: passos,
      });
      return;
    }

    if (resultado.kind === "dead") {
      await matar(execucao, deps, resumo, resultado.reason, {
        current_node_id: nodeId,
        context: contexto,
      });
      return;
    }

    await falhar(execucao, deps, resumo, resultado.error, {
      current_node_id: nodeId,
      context: contexto,
    });
    return;
  }

  // Bateu o teto do tick com a execução viva: salva onde parou e devolve o
  // controle. `pending` com relógio agora — o próximo tick continua daqui.
  await deps.db.atualizarExecucao(execucao.id, execucao.organization_id, {
    status: "pending",
    current_node_id: nodeId,
    next_eval_at: agora.toISOString(),
    claimed_until: null,
    steps_taken: passos,
    context: contexto,
    updated_at: agora.toISOString(),
  });
}

// ───────────────────────────── desfechos ─────────────────────────────────────

async function concluir(
  execucao: FlowExecutionRow,
  deps: TickDeps,
  resumo: TickSummary,
  outcome: string,
  extra: Partial<FlowExecutionPatch> = {},
): Promise<void> {
  const agora = deps.relogio();
  await deps.db.registrarPasso({
    organization_id: execucao.organization_id,
    execution_id: execucao.id,
    node_id: extra.current_node_id ?? execucao.current_node_id,
    event_type: "fluxo_concluido",
    payload: { desfecho: outcome },
    idempotency_key: `${execucao.id}:concluido`,
  });
  await deps.db.atualizarExecucao(execucao.id, execucao.organization_id, {
    ...extra,
    status: "completed",
    outcome,
    // Terminal NÃO tem relógio — é o que o CHECK `flow_executions_clock_check`
    // cobra no schema, para o estado não poder mentir.
    next_eval_at: null,
    claimed_until: null,
    completed_at: agora.toISOString(),
    updated_at: agora.toISOString(),
  });
  resumo.concluidas += 1;
}

async function falhar(
  execucao: FlowExecutionRow,
  deps: TickDeps,
  resumo: TickSummary,
  erro: string,
  extra: Partial<FlowExecutionPatch> = {},
): Promise<void> {
  const agora = deps.relogio();
  const tentativas = execucao.attempts + 1;
  const acabou = tentativas >= execucao.max_attempts;

  await deps.db.registrarPasso({
    organization_id: execucao.organization_id,
    execution_id: execucao.id,
    node_id: extra.current_node_id ?? execucao.current_node_id,
    event_type: acabou ? "fluxo_morreu" : "no_falhou",
    payload: { erro, tentativa: tentativas },
    idempotency_key: `${extra.current_node_id ?? execucao.current_node_id}:falha:${tentativas}`,
  });

  if (acabou) {
    await deps.db.atualizarExecucao(execucao.id, execucao.organization_id, {
      ...extra,
      status: "dead",
      last_error: erro,
      attempts: tentativas,
      next_eval_at: null,
      claimed_until: null,
      completed_at: agora.toISOString(),
      updated_at: agora.toISOString(),
    });
    await avisarQueMorreu(execucao, deps, erro);
    resumo.mortas += 1;
    return;
  }

  await deps.db.atualizarExecucao(execucao.id, execucao.organization_id, {
    ...extra,
    status: "pending",
    last_error: erro,
    attempts: tentativas,
    next_eval_at: backoffAte(agora, tentativas).toISOString(),
    claimed_until: null,
    updated_at: agora.toISOString(),
  });
  resumo.falhadas += 1;
}

async function matar(
  execucao: FlowExecutionRow,
  deps: TickDeps,
  resumo: TickSummary,
  motivo: string,
  extra: Partial<FlowExecutionPatch> = {},
): Promise<void> {
  const agora = deps.relogio();
  await deps.db.registrarPasso({
    organization_id: execucao.organization_id,
    execution_id: execucao.id,
    node_id: extra.current_node_id ?? execucao.current_node_id,
    event_type: "fluxo_morreu",
    payload: { motivo },
    idempotency_key: `${execucao.id}:morreu`,
  });
  await deps.db.atualizarExecucao(execucao.id, execucao.organization_id, {
    ...extra,
    status: "dead",
    last_error: motivo,
    next_eval_at: null,
    claimed_until: null,
    completed_at: agora.toISOString(),
    updated_at: agora.toISOString(),
  });
  await avisarQueMorreu(execucao, deps, motivo);
  resumo.mortas += 1;
}

/**
 * Execução morta abre aviso na Central. Sem isto, uma automação que parou de
 * funcionar é invisível até alguém reparar que o lead não foi distribuído — e
 * "silenciosamente parou" é o pior desfecho possível de um motor de automação.
 */
async function avisarQueMorreu(
  execucao: FlowExecutionRow,
  deps: TickDeps,
  motivo: string,
): Promise<void> {
  try {
    const nome = await deps.db.nomeDoFluxo(execucao.organization_id, execucao.flow_id);
    await deps.db.abrirAvisoDeMorte({
      organization_id: execucao.organization_id,
      titulo: `Automação parou: ${nome ?? "fluxo sem nome"}`,
      corpo: `Uma execução parou no bloco "${execucao.current_node_id}". Motivo: ${motivo}.`,
      refId: execucao.id,
    });
  } catch {
    // O aviso é secundário. Falhar aqui não pode desfazer o `dead` já gravado,
    // senão a execução voltaria a ser reclamada para morrer de novo, em laço.
  }
}
