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

import {
  escopoDaFrente,
  frentesDoFork,
  ondeGravar,
  proximoPassoDoLaco,
  veredictoDoEncontro,
  type EncontroRow,
  type FrenteNova,
  type FrentePatch,
  type FrenteRow,
} from "./frentes";
import { analisarGrafo, arestaDoRamo, flowGraphSchema, noPorId } from "./graph-schema";
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
  /**
   * O PAYLOAD QUE ARMOU a execução — vira `{{event.*}}` no escopo.
   *
   * Antes disto `trigger-matcher.ts` gravava `context: {}` literal e do evento
   * sobreviviam só `lead_id`, `contact_id` e a linhagem: um gatilho de "mensagem
   * recebida" não conseguia ler o TEXTO da mensagem, e um de webhook não lia
   * nada do corpo que o terceiro mandou. Metade dos gatilhos era decorativa.
   *
   * `{}` quando a execução não nasceu de evento (chamada manual, sub-fluxo sem
   * entrada).
   */
  input: Record<string, unknown>;
  /** O que a execução DEVOLVE a quem a chamou. Só sub-fluxo lê. */
  output: Record<string, unknown>;
  /** Quem chamou, quando esta execução é um sub-fluxo. `null` no topo. */
  parent_execution_id: string | null;
  /** A frente exata que ficou parada esperando esta filha. `null` no topo. */
  parent_frame_id: string | null;
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
  output?: Record<string, unknown>;
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

  // ─────────────────────── o que o paralelo acrescenta ───────────────────────

  /**
   * As frentes PRONTAS desta execução, e a raiz quando ainda não há nenhuma.
   *
   * A auto-cura da raiz é o que faz o paralelo entrar sem migração de dados:
   * toda execução que já estava viva quando a tabela nasceu não tem frente
   * nenhuma, e criar a raiz a partir do `current_node_id` dela é exatamente o
   * estado em que ela estava. Sem isso, ou toda execução em voo morreria no
   * primeiro tick pós-deploy, ou seria preciso um backfill que o self-hoster
   * teria de rodar à mão — e a doutrina de migrations proíbe pedir isso.
   */
  frentesProntas(exec: FlowExecutionRow): Promise<FrenteRow[]>;
  criarFrentes(frentes: FrenteNova[]): Promise<FrenteRow[]>;
  atualizarFrente(id: string, orgId: string, patch: FrentePatch): Promise<void>;
  /** Quantas frentes desta execução ainda podem andar (`ready` ou `waiting`). */
  frentesVivas(executionId: string, orgId: string): Promise<number>;
  /**
   * Relê UMA frente. `null` quando sumiu.
   *
   * ⚠️ Existe por causa de um defeito medido: as frentes de um tick são lidas
   * de uma vez, e uma corrida (`modo: "primeira"`) cancela as irmãs NO MEIO
   * dessa lista. Sem reler antes de caminhar, a perdedora — já marcada como
   * cancelada no banco — seguia andando na mesma rodada, executando os blocos
   * do ramo que acabara de perder. Uma cobrança automática pode sair daí.
   */
  relerFrente(id: string, orgId: string): Promise<FrenteRow | null>;
  /**
   * O relógio MAIS PRÓXIMO entre as frentes vivas. `null` quando não há nenhuma.
   *
   * Existe porque `flow_executions.next_eval_at` virou espelho: quem manda no
   * tempo agora é a frente. Sem esta ressincronia, qualquer coisa que acorde a
   * execução antes da hora (um retry, uma escrita de fora) deixa a linha com um
   * relógio vencido que nenhuma frente honra — e o claim passa a trazer essa
   * execução de volta a CADA tick, para não fazer nada, ocupando uma das 20
   * vagas do lote para sempre.
   */
  relogioDasFrentesVivas(executionId: string, orgId: string): Promise<string | null>;
  /**
   * Abre o encontro de um fork, se ainda não existe. `esperadas` vem do número
   * de DESTINOS resolvidos, nunca de ramos declarados no nó.
   */
  abrirEncontro(encontro: {
    organization_id: string;
    execution_id: string;
    fork_node_id: string;
    join_node_id: string;
    modo: "todas" | "primeira";
    esperadas: number;
  }): Promise<void>;
  /**
   * Soma uma chegada e devolve o estado DEPOIS da soma.
   *
   * ⚠️ O incremento tem de ser atômico no banco (`set chegadas = chegadas + 1
   * returning *`). Ler-somar-gravar em dois passos perde uma chegada quando
   * duas frentes alcançam o merge no mesmo tick, e o efeito é um merge em modo
   * `todas` que nunca dispara: fluxo parado para sempre, sem erro.
   */
  chegarNoEncontroSePreciso(input: {
    organization_id: string;
    execution_id: string;
    fork_node_id: string;
    /** Onde a frente esta agora. So conta chegada se for o `join_node_id`. */
    node_id: string;
  }): Promise<EncontroRow | null>;
  /** Marca o encontro como resolvido. Idempotente: só grava se ainda era nulo. */
  resolverEncontro(input: {
    organization_id: string;
    execution_id: string;
    fork_node_id: string;
    em: string;
  }): Promise<void>;
  /** Cancela as irmãs perdedoras de uma corrida (`modo: "primeira"`). */
  cancelarFrentesIrmas(input: {
    organization_id: string;
    execution_id: string;
    fork_node_id: string;
    excetoFrenteId: string;
  }): Promise<void>;
  /**
   * `organizations.settings.flow_globals` — o que é igual em todo fluxo da org.
   * Trocar o telefone do suporte num lugar só, em vez de em trinta fluxos.
   */
  carregarGlobais(orgId: string): Promise<Record<string, unknown>>;
  /** Dispara um sub-fluxo e devolve o id da execução filha. */
  chamarSubFluxo(input: {
    organization_id: string;
    flow_id: string;
    input: Record<string, unknown>;
    parent_execution_id: string;
    parent_frame_id: string;
    lead_id: string | null;
    contact_id: string | null;
    conversation_id: string | null;
  }): Promise<{ execution_id: string } | null>;
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

/**
 * Percorre UMA execução: carrega o grafo uma vez e caminha cada frente pronta.
 *
 * O grafo, os fatos e as globais são carregados AQUI e não por frente de
 * propósito: num fork de três ramos, carregar por frente seria três leituras do
 * mesmo grafo imutável no mesmo tick.
 */
async function caminhar(
  execucao: FlowExecutionRow,
  deps: TickDeps,
  resumo: TickSummary,
): Promise<void> {
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
  const analisado = analisarGrafo(parsed.data);
  if (analisado.erros.length > 0) {
    await matar(execucao, deps, resumo, `grafo_invalido:${analisado.erros[0]!.codigo}`);
    return;
  }

  const frentes = await deps.db.frentesProntas(execucao);
  if (frentes.length === 0) {
    // Reclamada sem nenhuma frente vencida: as que existem estão dormindo em
    // espera ou em evento. Não é erro, é a execução parada onde devia estar —
    // mas o relógio DELA pode estar mentindo, e aí ela voltaria a cada tick.
    const proximo = await deps.db.relogioDasFrentesVivas(
      execucao.id,
      execucao.organization_id,
    );
    if (proximo !== null && proximo !== execucao.next_eval_at) {
      await deps.db.atualizarExecucao(execucao.id, execucao.organization_id, {
        status: "waiting",
        next_eval_at: proximo,
        claimed_until: null,
        updated_at: deps.relogio().toISOString(),
      });
    }
    return;
  }

  const globais = await deps.db.carregarGlobais(execucao.organization_id);
  const portas = deps.portas(execucao);
  const desfechos: string[] = [];

  for (const frente of frentes) {
    // Relê antes de caminhar: a frente pode ter sido cancelada por uma IRMÃ
    // que venceu a corrida mais cedo NESTE MESMO tick.
    const agora = await deps.db.relerFrente(frente.id, execucao.organization_id);
    if (agora === null) continue;
    if (agora.status !== "ready" && agora.status !== "waiting") continue;
    await caminharFrente({
      execucao,
      frente: agora,
      analisado,
      deps,
      resumo,
      globais,
      portas,
      desfechos,
    });
  }

  await talvezEncerrarExecucao(execucao, deps, resumo, desfechos);
}

interface PasseioDaFrente {
  execucao: FlowExecutionRow;
  frente: FrenteRow;
  analisado: ReturnType<typeof analisarGrafo>;
  deps: TickDeps;
  resumo: TickSummary;
  globais: Record<string, unknown>;
  portas: PortasDaExecucao;
  /** Desfechos das frentes ja encerradas neste tick, na ordem. */
  desfechos: string[];
}

/** Caminha UMA frente até bater numa espera, num fim, ou no teto do tick. */
async function caminharFrente(p: PasseioDaFrente): Promise<void> {
  const { execucao, deps, resumo, analisado } = p;
  const agora = deps.relogio();

  let fatos = await deps.db.carregarFatos(execucao.organization_id, execucao);
  let nodeId = p.frente.node_id;
  let contexto = { ...execucao.context };
  let locais = { ...p.frente.vars };
  let passos = p.frente.steps_taken;
  let laco: { node_id: string | null; index: number | null; total: number | null } = {
    node_id: p.frente.loop_node_id,
    index: p.frente.loop_index,
    total: p.frente.loop_total,
  };

  /**
   * ESTA volta acordou por PRAZO VENCIDO, e não porque o evento chegou.
   *
   * ⚠️ Sem esta marca, `logic.await_event` é um laço infinito silencioso: o
   * prazo vence, o claim traz a frente de volta, o nó roda outra vez e devolve
   * `await_event` com um prazo NOVO. A frente dorme mais um prazo, para sempre,
   * e o ramo "venceu o prazo" que o operador desenhou nunca é percorrido.
   *
   * Só vale para o PRIMEIRO nó desta caminhada — o nó em que a frente estava
   * parada. Depois de avançar, quem manda é o nó novo.
   */
  let acordouPorPrazo =
    p.frente.awaiting_event_type !== null &&
    p.frente.wait_deadline !== null &&
    Date.parse(p.frente.wait_deadline) <= agora.getTime();

  /** Une o que a frente sabe ao que o motor precisa gravar nela. */
  const frenteAgora = (): FrenteRow => ({
    ...p.frente,
    node_id: nodeId,
    vars: locais,
    steps_taken: passos,
    loop_node_id: laco.node_id,
    loop_index: laco.index,
    loop_total: laco.total,
  });

  for (let doTick = 0; doTick < PASSOS_POR_TICK; doTick += 1) {
    if (passos >= PASSOS_MAXIMOS) {
      await matar(execucao, deps, resumo, "passos_demais", {
        current_node_id: nodeId,
        context: contexto,
      });
      return;
    }

    // ── o reencontro, ANTES de executar o nó ──
    //
    // Quem decide se um merge pode seguir é o motor, não o bloco: o bloco de
    // merge não sabe quantas irmãs existem nem quem já chegou. Deixá-lo decidir
    // exigiria dar a ele acesso ao banco, e aí ele deixaria de ser puro como
    // todos os outros.
    if (p.frente.fork_node_id !== null) {
      const encontro = await deps.db.chegarNoEncontroSePreciso({
        organization_id: execucao.organization_id,
        execution_id: execucao.id,
        fork_node_id: p.frente.fork_node_id,
        node_id: nodeId,
      });
      if (encontro !== null) {
        const veredicto = veredictoDoEncontro(encontro);
        await deps.db.registrarPasso({
          organization_id: execucao.organization_id,
          execution_id: execucao.id,
          node_id: nodeId,
          event_type: "frente_chegou_no_encontro",
          payload: {
            fork: p.frente.fork_node_id,
            modo: encontro.modo,
            chegadas: encontro.chegadas,
            esperadas: encontro.esperadas,
            segue: veredicto.kind === "segue",
          },
          idempotency_key: `${p.frente.id}:encontro:${nodeId}`,
        });

        if (veredicto.kind === "para") {
          await encerrarFrente(p, { node_id: nodeId, vars: locais, steps_taken: passos });
          return;
        }

        await deps.db.resolverEncontro({
          organization_id: execucao.organization_id,
          execution_id: execucao.id,
          fork_node_id: p.frente.fork_node_id,
          em: agora.toISOString(),
        });
        if (veredicto.cancelar_irmas) {
          // É o que faz "OU" significar OU: sem isto, o ramo do tempo segue
          // rodando depois de o cliente ter respondido, e a cobrança automática
          // sai logo após a pessoa dizer que ia pagar.
          await deps.db.cancelarFrentesIrmas({
            organization_id: execucao.organization_id,
            execution_id: execucao.id,
            fork_node_id: p.frente.fork_node_id,
            excetoFrenteId: p.frente.id,
          });
        }
        // A frente vencedora deixa de ser filha do fork: daqui para a frente ela
        // é a linha principal outra vez, e volta a gravar no espaço compartilhado.
        p.frente = { ...p.frente, fork_node_id: null };
      }
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
      event: execucao.input,
      frame: escopoDaFrente(frenteAgora()),
      global: p.globais,
    };
    const ctx: FlowExecutionContext = {
      organizationId: execucao.organization_id,
      executionId: execucao.id,
      nodeId,
      fatos,
      escopo,
      esperaEmCurso: espera,
      crm: p.portas.crm,
      roteamento: p.portas.roteamento,
      canal: p.portas.canal,
      avisos: p.portas.avisos,
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
      // ⚠️ AQUI mora o paralelo correto. Fora de fork a escrita cai no espaço
      // compartilhado — é o que mantém `{{vars.x}}` funcionando como sempre.
      // Dentro de fork cai no espaço da frente, senão dois ramos gravando a
      // mesma chave entregam o valor de quem terminou por último, sem erro.
      if (ondeGravar(p.frente) === "execucao") {
        contexto = { ...contexto, ...(resultado.vars ?? {}) };
      } else {
        locais = { ...locais, ...(resultado.vars ?? {}) };
      }

      passos += 1;
      const aresta = arestaDoRamo(analisado.arestas, nodeId, resultado.branch_id);
      await deps.db.registrarPasso({
        organization_id: execucao.organization_id,
        execution_id: execucao.id,
        node_id: nodeId,
        event_type: "no_avancou",
        payload: { ramo: resultado.branch_id, proximo: aresta?.target ?? null },
        // A chave inclui o número do passo E a frente: o MESMO nó pode ser
        // visitado de novo (a redistribuição volta ao rodízio, o laço repete o
        // corpo), e duas frentes irmãs podem pisar no mesmo nó no mesmo passo.
        // Uma chave só com o id do nó faria a segunda visita ser engolida.
        idempotency_key: `${p.frente.id}:${nodeId}:avanco:${passos}`,
      });

      if (aresta === null) {
        // Ramo sem saída é o fim daquele caminho, e foi desenhado assim de
        // propósito (a validação de publicação só exige saída em ramo de REGRA).
        await encerrarFrente(p, { node_id: nodeId, vars: locais, steps_taken: passos });
        await registrarDesfechoDaFrente(p, `sem_saida:${resultado.branch_id}`, contexto, nodeId);
        return;
      }
      // Recarrega os fatos quando o nó DECLAROU que mexeu no CRM. Sem isto, o
      // `whatsapp.notify_user` logo depois do rodízio lia `assigned_user` como
      // `null` — o vendedor era escolhido e nunca avisado, e nada acusava.
      if (exigirNo(no.type).mutaCrm === true) {
        fatos = await deps.db.carregarFatos(execucao.organization_id, execucao);
      }

      nodeId = aresta.target;
      acordouPorPrazo = false;
      resumo.avancadas += 1;
      continue;
    }

    if (resultado.kind === "loop") {
      const passo = proximoPassoDoLaco({
        indiceAtual: laco.node_id === nodeId ? laco.index : null,
        totalDeItens: resultado.items.length,
        max: resultado.max,
      });
      const ramo = passo.kind === "corpo" ? resultado.body_branch_id : resultado.done_branch_id;
      const aresta = arestaDoRamo(analisado.arestas, nodeId, ramo);
      passos += 1;

      if (passo.kind === "corpo") {
        laco = { node_id: nodeId, index: passo.indice, total: passo.total };
        // O item da vez entra no espaço da frente, nunca no compartilhado: dois
        // laços em ramos paralelos gravariam `item` um por cima do outro.
        locais = { ...locais, item: resultado.items[passo.indice] ?? null };
      } else {
        laco = { node_id: null, index: null, total: null };
      }

      await deps.db.registrarPasso({
        organization_id: execucao.organization_id,
        execution_id: execucao.id,
        node_id: nodeId,
        event_type: passo.kind === "corpo" ? "laco_repetiu" : "laco_terminou",
        payload:
          passo.kind === "corpo"
            ? { indice: passo.indice, total: passo.total }
            : { itens: resultado.items.length },
        idempotency_key: `${p.frente.id}:${nodeId}:laco:${passos}`,
      });

      if (aresta === null) {
        await encerrarFrente(p, { node_id: nodeId, vars: locais, steps_taken: passos });
        await registrarDesfechoDaFrente(p, `sem_saida:${ramo}`, contexto, nodeId);
        return;
      }
      nodeId = aresta.target;
      resumo.avancadas += 1;
      continue;
    }

    if (resultado.kind === "fork") {
      // Uma frente por DESTINO, não por ramo declarado. Um ramo que ninguém
      // ligou no canvas viraria uma frente que nunca anda mas conta em
      // `esperadas`, e o merge em modo `todas` esperaria por ela para sempre:
      // fluxo travado, sem erro, sem log. O modo de falha mais caro que este
      // motor pode ter.
      const destinos = resultado.branch_ids
        .map((ramo) => arestaDoRamo(analisado.arestas, nodeId, ramo)?.target ?? null)
        .filter((alvo): alvo is string => alvo !== null);

      if (destinos.length === 0) {
        await encerrarFrente(p, { node_id: nodeId, vars: locais, steps_taken: passos });
        await registrarDesfechoDaFrente(p, "fork_sem_saida", contexto, nodeId);
        return;
      }

      passos += 1;
      await deps.db.abrirEncontro({
        organization_id: execucao.organization_id,
        execution_id: execucao.id,
        fork_node_id: nodeId,
        join_node_id: resultado.join_node_id,
        modo: resultado.modo,
        esperadas: destinos.length,
      });
      const novas: FrenteNova[] = frentesDoFork({
        organizationId: execucao.organization_id,
        executionId: execucao.id,
        paiId: p.frente.id,
        forkNodeId: nodeId,
        destinos,
        varsDoPai: locais,
        agoraIso: agora.toISOString(),
      });
      await deps.db.criarFrentes(novas);
      await deps.db.registrarPasso({
        organization_id: execucao.organization_id,
        execution_id: execucao.id,
        node_id: nodeId,
        event_type: "fluxo_bifurcou",
        payload: {
          modo: resultado.modo,
          frentes: destinos.length,
          encontro: resultado.join_node_id,
        },
        idempotency_key: `${p.frente.id}:${nodeId}:fork:${passos}`,
      });

      // A frente que bifurcou cumpriu o papel dela: quem carrega o fluxo agora
      // são as filhas. Mantê-la viva faria o fan-out ter N+1 caminhos.
      await encerrarFrente(p, { node_id: nodeId, vars: locais, steps_taken: passos });
      await deps.db.atualizarExecucao(execucao.id, execucao.organization_id, {
        status: "pending",
        current_node_id: nodeId,
        next_eval_at: agora.toISOString(),
        claimed_until: null,
        context: contexto,
        updated_at: agora.toISOString(),
      });
      return;
    }

    if (resultado.kind === "await_event") {
      if (acordouPorPrazo) {
        // O prazo venceu: sai pelo ramo que o operador desenhou para isso, em
        // vez de dormir mais um prazo. É AQUI que "venceu o prazo" acontece.
        acordouPorPrazo = false;
        passos += 1;
        const saida = arestaDoRamo(analisado.arestas, nodeId, resultado.branch_on_timeout);
        await deps.db.registrarPasso({
          organization_id: execucao.organization_id,
          execution_id: execucao.id,
          node_id: nodeId,
          event_type: "prazo_do_evento_venceu",
          payload: { evento: resultado.event_type, ramo: resultado.branch_on_timeout },
          idempotency_key: `${p.frente.id}:${nodeId}:prazo:${passos}`,
        });
        // A frente deixa de esperar: manter `awaiting_event_type` faria um
        // evento atrasado acordá-la depois de ela já ter seguido pelo prazo.
        await deps.db.atualizarFrente(p.frente.id, execucao.organization_id, {
          awaiting_event_type: null,
          awaiting_match: null,
          wait_deadline: null,
          updated_at: agora.toISOString(),
        });
        p.frente = {
          ...p.frente,
          awaiting_event_type: null,
          awaiting_match: null,
          wait_deadline: null,
        };
        if (saida === null) {
          await encerrarFrente(p, { node_id: nodeId, vars: locais, steps_taken: passos });
          await registrarDesfechoDaFrente(p, `sem_saida:${resultado.branch_on_timeout}`, contexto, nodeId);
          return;
        }
        nodeId = saida.target;
        resumo.avancadas += 1;
        continue;
      }
      // `timeout_at` é obrigatório no tipo, e é o que impede a espera por evento
      // de virar uma execução que nada no sistema jamais coleta. O relógio da
      // frente é o prazo: vencido ele, o próprio claim a traz de volta e ela sai
      // pelo `branch_on_timeout` no bloco acima.
      await deps.db.registrarPasso({
        organization_id: execucao.organization_id,
        execution_id: execucao.id,
        node_id: nodeId,
        event_type: "espera_por_evento",
        payload: {
          evento: resultado.event_type,
          ate: resultado.timeout_at.toISOString(),
          saida_no_prazo: resultado.branch_on_timeout,
        },
        idempotency_key: `${p.frente.id}:${nodeId}:evento:${passos}`,
      });
      await deps.db.atualizarFrente(p.frente.id, execucao.organization_id, {
        node_id: nodeId,
        status: "waiting",
        next_eval_at: resultado.timeout_at.toISOString(),
        claimed_until: null,
        vars: locais,
        steps_taken: passos,
        awaiting_event_type: resultado.event_type,
        awaiting_match: resultado.match ?? {},
        wait_deadline: resultado.timeout_at.toISOString(),
        updated_at: agora.toISOString(),
      });
      await dormirAExecucao(execucao, deps, resultado.timeout_at, nodeId, contexto);
      resumo.esperando += 1;
      return;
    }

    if (resultado.kind === "call_subflow") {
      const filha = await deps.db.chamarSubFluxo({
        organization_id: execucao.organization_id,
        flow_id: resultado.flow_id,
        input: resultado.input,
        parent_execution_id: execucao.id,
        parent_frame_id: p.frente.id,
        lead_id: execucao.lead_id,
        contact_id: execucao.contact_id,
        conversation_id: execucao.conversation_id,
      });
      if (filha === null) {
        // Sub-fluxo que não existe (ou não está publicado) é defeito de
        // desenho, e repetir não conserta.
        await matar(execucao, deps, resumo, `subfluxo_indisponivel:${resultado.flow_id}`, {
          current_node_id: nodeId,
          context: contexto,
        });
        return;
      }
      passos += 1;
      // A espera pela filha reusa a máquina de espera por evento em vez de ter
      // uma sua: é o MESMO problema (dormir até algo chegar, com prazo), e uma
      // segunda máquina seria um segundo lugar onde esquecer o prazo.
      const prazo = new Date(agora.getTime() + PRAZO_DO_SUBFLUXO_MS);
      await deps.db.registrarPasso({
        organization_id: execucao.organization_id,
        execution_id: execucao.id,
        node_id: nodeId,
        event_type: "subfluxo_chamado",
        payload: { fluxo: resultado.flow_id, execucao_filha: filha.execution_id },
        idempotency_key: `${p.frente.id}:${nodeId}:subfluxo:${passos}`,
      });
      await deps.db.atualizarFrente(p.frente.id, execucao.organization_id, {
        node_id: nodeId,
        status: "waiting",
        next_eval_at: prazo.toISOString(),
        claimed_until: null,
        vars: locais,
        steps_taken: passos,
        awaiting_event_type: EVENTO_DE_SUBFLUXO,
        awaiting_match: { execution_id: filha.execution_id },
        wait_deadline: prazo.toISOString(),
        updated_at: agora.toISOString(),
      });
      await dormirAExecucao(execucao, deps, prazo, nodeId, contexto);
      resumo.esperando += 1;
      return;
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
        idempotency_key: `${p.frente.id}:${nodeId}:espera:${passos}`,
      });
      await deps.db.atualizarFrente(p.frente.id, execucao.organization_id, {
        node_id: nodeId,
        status: "waiting",
        next_eval_at: resultado.next_eval_at.toISOString(),
        claimed_until: null,
        vars: locais,
        steps_taken: passos,
        updated_at: agora.toISOString(),
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
      if (ondeGravar(p.frente) === "execucao") {
        contexto = { ...contexto, ...(resultado.vars ?? {}) };
      } else {
        locais = { ...locais, ...(resultado.vars ?? {}) };
      }
      await encerrarFrente(p, { node_id: nodeId, vars: locais, steps_taken: passos });
      await registrarDesfechoDaFrente(p, resultado.outcome, contexto, nodeId);
      return;
    }

    if (resultado.kind === "dead") {
      await matar(execucao, deps, resumo, resultado.reason, {
        current_node_id: nodeId,
        context: contexto,
      });
      return;
    }

    // ⚠️ `fail` e `dead` matam a EXECUÇÃO inteira, não só esta frente, e é
    // deliberado: uma automação com um ramo quebrado entregou metade do que
    // prometeu. Deixar as irmãs seguirem daria um resultado parcial que ninguém
    // pediu e que nada acusa — pior que a falha inteira, que ao menos abre aviso
    // na Central.
    await falhar(execucao, deps, resumo, resultado.error, {
      current_node_id: nodeId,
      context: contexto,
    });
    return;
  }

  // Bateu o teto do tick com a frente viva: salva onde parou e devolve o
  // controle. `pending` com relógio agora — o próximo tick continua daqui.
  await deps.db.atualizarFrente(p.frente.id, execucao.organization_id, {
    node_id: nodeId,
    status: "ready",
    next_eval_at: agora.toISOString(),
    claimed_until: null,
    vars: locais,
    steps_taken: passos,
    loop_node_id: laco.node_id,
    loop_index: laco.index,
    loop_total: laco.total,
    updated_at: agora.toISOString(),
  });
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

/** Quanto uma frente espera por um sub-fluxo antes de desistir. */
const PRAZO_DO_SUBFLUXO_MS = 24 * 60 * 60_000;

/** O evento que uma execução filha emite ao terminar. */
export const EVENTO_DE_SUBFLUXO = "flow.subflow_finished";

/** Fecha a frente como cumprida, guardando onde ela parou. */
async function encerrarFrente(
  p: PasseioDaFrente,
  onde: { node_id: string; vars: Record<string, unknown>; steps_taken: number },
): Promise<void> {
  await p.deps.db.atualizarFrente(p.frente.id, p.execucao.organization_id, {
    node_id: onde.node_id,
    status: "done",
    // Terminal NÃO tem relógio — é o que o CHECK `flow_execution_frames_clock_check`
    // cobra no schema, para o estado não poder mentir.
    next_eval_at: null,
    claimed_until: null,
    vars: onde.vars,
    steps_taken: onde.steps_taken,
    awaiting_event_type: null,
    awaiting_match: null,
    wait_deadline: null,
    updated_at: p.deps.relogio().toISOString(),
  });
}

/** Guarda o desfecho que ESTA frente alcançou, para o encerramento ler depois. */
async function registrarDesfechoDaFrente(
  p: PasseioDaFrente,
  desfecho: string,
  contexto: Record<string, unknown>,
  // ⚠️ O nó ONDE A FRENTE PAROU, não o de onde ela partiu. `p.frente.node_id` é
  // o começo da caminhada, e usá-lo fazia o log dizer que o fluxo terminou no
  // primeiro bloco do ramo — uma linha de auditoria que aponta para o lugar
  // errado é pior que nenhuma, porque quem lê acredita nela.
  ondeParou: string,
): Promise<void> {
  await p.deps.db.registrarPasso({
    organization_id: p.execucao.organization_id,
    execution_id: p.execucao.id,
    node_id: ondeParou,
    event_type: "frente_concluiu",
    payload: { desfecho },
    idempotency_key: `${p.frente.id}:concluiu`,
  });
  // O contexto acumulado tem de sobreviver à frente que o produziu: a próxima
  // frente do mesmo tick lê `execucao.context`, e sem esta linha ela leria o
  // estado de antes — o ramo B não enxergaria o que o ramo A gravou.
  p.execucao.context = contexto;
  p.desfechos.push(desfecho);
}

/** Põe a execução para dormir junto com a frente que dorme. */
async function dormirAExecucao(
  execucao: FlowExecutionRow,
  deps: TickDeps,
  ate: Date,
  nodeId: string,
  contexto: Record<string, unknown>,
): Promise<void> {
  await deps.db.atualizarExecucao(execucao.id, execucao.organization_id, {
    status: "waiting",
    current_node_id: nodeId,
    next_eval_at: ate.toISOString(),
    claimed_until: null,
    attempts: 0,
    last_error: null,
    context: contexto,
    updated_at: deps.relogio().toISOString(),
  });
}

/**
 * A execução acaba quando a ÚLTIMA frente acaba — não quando a primeira acaba.
 *
 * Concluir na primeira mataria os ramos irmãos de um fork no meio do caminho, e
 * o sintoma seria uma automação que faz só o ramo mais rápido: sem erro, com o
 * fluxo marcado como concluído, e o resto simplesmente não acontecendo.
 */
async function talvezEncerrarExecucao(
  execucao: FlowExecutionRow,
  deps: TickDeps,
  resumo: TickSummary,
  desfechos: string[],
): Promise<void> {
  const vivas = await deps.db.frentesVivas(execucao.id, execucao.organization_id);
  if (vivas > 0) return;
  await concluir(execucao, deps, resumo, desfechos[desfechos.length - 1] ?? "concluido", {
    context: execucao.context,
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
