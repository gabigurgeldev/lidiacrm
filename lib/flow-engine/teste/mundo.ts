/**
 * O MUNDO FALSO do motor de fluxos — um Postgres de mentira que cabe na cabeça.
 *
 * Mora fora dos arquivos de teste porque há mais de um: `engine.test.ts` prova a
 * fatia vertical do produto e `paralelo.test.ts` prova o fan-out, e os dois
 * precisam do mesmo banco. Duas cópias divergiriam no primeiro conserto — e a
 * cópia que não recebesse o conserto seguiria verde, provando um motor que não
 * existe mais.
 *
 * ⚠️ Nada aqui simula o Postgres bem: simula o CONTRATO que `FlowAdminClient`
 * declara, e só. Onde o comportamento do banco importa de verdade — a atomicidade
 * do `fn_flow_join_arrive`, os CHECKs de relógio — quem prova é `tests/invariants`,
 * contra um Postgres real.
 */

import { garantirNosRegistrados } from "../register-all";
import type {
  FlowAdminClient,
  FlowExecutionPatch,
  FlowExecutionRow,
  PortasDaExecucao,
} from "../engine";
import type { FrenteNova, FrenteRow } from "../frentes";
import type { FlowGraph } from "../graph-schema";
import type { AtendenteElegivel, DesfechoDeEnvio, FatosDaExecucao } from "../types";

const ORG = "org-1";
const LEAD = "lead-1";
const VERSAO = "versao-1";

export interface Mundo {
  execucoes: Map<string, FlowExecutionRow>;
  passos: Array<{ execution_id: string; node_id: string | null; event_type: string; payload: Record<string, unknown>; idempotency_key: string }>;
  esperas: Map<string, { desde: Date; ate: Date }>;
  atribuicoes: Array<{ leadId: string; userId: string }>;
  tags: string[];
  enviados: Array<{ telefone: string; texto: string }>;
  /** O que foi mandado ao CLIENTE — outra lista, porque é outro destinatário. */
  /** Campanhas que o bloco de disparo pediu. */
  disparosPedidos: Array<Record<string, unknown>>;
  /** O que a porta de disparo devolve — o teste troca para exercitar recusa. */
  desfechoDoDisparo: { kind: "criado"; disparoId: string; vaoReceber: number; comecou: boolean } | { kind: "recusado"; motivo: string };
  enviadosAoCliente: Array<{
    contactId: string;
    tipo: string;
    texto: string;
    mediaUrl?: string;
    channelSessionId: string | null;
  }>;
  avisos: Array<{ titulo: string; corpo: string }>;
  elegiveis: AtendenteElegivel[];
  donoRespondeu: boolean;
  desfechoDoEnvio: DesfechoDeEnvio;
  score: number | null;
  telefoneDoDono: string | null;
  agora: Date;
  frentes: Map<string, FrenteRow>;
  encontros: Map<string, {
    execution_id: string;
    fork_node_id: string;
    join_node_id: string;
    modo: "todas" | "primeira";
    esperadas: number;
    chegadas: number;
    resolvido_em: string | null;
  }>;
  globais: Record<string, unknown>;
  subFluxosPublicados: Set<string>;
  avisosDeSubFluxo: Array<{ execution_id: string; parent_execution_id: string; outcome: string }>;
}

let proximaFrente = 0;

/** Nasce uma frente no mundo falso, com id proprio. */
function novaFrente(mundo: Mundo, nova: FrenteNova): FrenteRow {
  proximaFrente += 1;
  const linha: FrenteRow = {
    ...nova,
    id: `frente-${proximaFrente}`,
    awaiting_event_type: null,
    awaiting_match: null,
    wait_deadline: null,
    loop_node_id: null,
    loop_index: null,
    loop_total: null,
  };
  mundo.frentes.set(linha.id, linha);
  return linha;
}

export function mundoNovo(): Mundo {
  return {
    execucoes: new Map(),
    passos: [],
    esperas: new Map(),
    atribuicoes: [],
    tags: [],
    enviados: [],
    disparosPedidos: [],
    desfechoDoDisparo: { kind: "criado", disparoId: "disparo-1", vaoReceber: 3, comecou: false },
    enviadosAoCliente: [],
    avisos: [],
    elegiveis: [
      { userId: "user-antigo", lastAssignedAt: Date.parse("2026-08-01T00:00:00Z"), currentLoad: 1 },
      { userId: "user-recente", lastAssignedAt: Date.parse("2026-08-29T00:00:00Z"), currentLoad: 1 },
    ],
    donoRespondeu: false,
    desfechoDoEnvio: { kind: "enviado", messageId: "msg-1" },
    score: 82,
    telefoneDoDono: "+5563999112061",
    agora: new Date("2026-08-30T12:00:00.000Z"),
    frentes: new Map(),
    encontros: new Map(),
    globais: {},
    subFluxosPublicados: new Set(),
    avisosDeSubFluxo: [],
  };
}

export function execucaoNova(): FlowExecutionRow {
  return {
    id: "exec-1",
    organization_id: ORG,
    flow_id: "flow-1",
    version_id: VERSAO,
    status: "pending",
    current_node_id: "inicio",
    next_eval_at: "2026-08-30T12:00:00.000Z",
    attempts: 0,
    max_attempts: 5,
    steps_taken: 0,
    context: {},
    lead_id: LEAD,
    contact_id: "contato-1",
    conversation_id: null,
    started_at: "2026-08-30T12:00:00.000Z",
    input: {},
    output: {},
    parent_execution_id: null,
    parent_frame_id: null,
  };
}

export function montar(mundo: Mundo, grafo: FlowGraph) {
  const db: FlowAdminClient = {
    reclamarVencidas: async () =>
      [...mundo.execucoes.values()].filter(
        (e) =>
          ["pending", "running", "waiting"].includes(e.status) &&
          e.next_eval_at !== null &&
          Date.parse(e.next_eval_at) <= mundo.agora.getTime(),
      ),
    carregarGrafo: async () => grafo,
    carregarFatos: async (): Promise<FatosDaExecucao> => ({
      lead: {
        id: LEAD,
        title: "Loja do Gabriel",
        status: "open",
        stage_id: "etapa-1",
        pipeline_id: "funil-1",
        owner_user_id: mundo.atribuicoes.at(-1)?.userId ?? null,
        value_cents: 150_000,
        source: "meta_ads",
        tags: mundo.tags,
        custom_fields: {},
        score: mundo.score,
        score_band: null,
        created_at: "2026-08-30T11:59:00.000Z",
      },
      contact: {
        id: "contato-1",
        name: "Gabriel",
        phone_number: "+559481004900",
        email: null,
        tags: [],
        is_blocked: false,
      },
      assigned_user:
        mundo.atribuicoes.length === 0
          ? null
          : {
              id: mundo.atribuicoes.at(-1)!.userId,
              name: "Vendedor",
              notification_phone: mundo.telefoneDoDono,
            },
    }),
    esperaEmCurso: async (execId, nodeId) => mundo.esperas.get(`${execId}:${nodeId}`) ?? null,
    registrarPasso: async (evento) => {
      if (mundo.passos.some((p) => p.idempotency_key === evento.idempotency_key && p.execution_id === evento.execution_id)) {
        return { inserted: false };
      }
      mundo.passos.push(evento);
      if (evento.event_type === "espera_iniciada" || evento.event_type === "espera_por_evento") {
        mundo.esperas.set(`${evento.execution_id}:${evento.node_id}`, {
          desde: mundo.agora,
          ate: new Date(String(evento.payload.ate)),
        });
      }
      return { inserted: true };
    },
    atualizarExecucao: async (id, _orgId, patch: FlowExecutionPatch) => {
      const atual = mundo.execucoes.get(id)!;
      mundo.execucoes.set(id, {
        ...atual,
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.current_node_id !== undefined ? { current_node_id: patch.current_node_id } : {}),
        ...(patch.next_eval_at !== undefined ? { next_eval_at: patch.next_eval_at } : {}),
        ...(patch.attempts !== undefined ? { attempts: patch.attempts } : {}),
        ...(patch.steps_taken !== undefined ? { steps_taken: patch.steps_taken } : {}),
        ...(patch.context !== undefined ? { context: patch.context } : {}),
      });
    },
    frentesProntas: async (exec) => {
      const daExecucao = [...mundo.frentes.values()].filter((f) => f.execution_id === exec.id);
      const prontas = daExecucao.filter(
        (f) =>
          (f.status === "ready" || f.status === "waiting") &&
          f.next_eval_at !== null &&
          Date.parse(f.next_eval_at) <= mundo.agora.getTime(),
      );
      if (prontas.length > 0) return prontas.map((f) => ({ ...f }));
      if (daExecucao.length > 0) return [];
      // A auto-cura da raiz, igual à do adapter: execução sem frente nenhuma é
      // execução anterior à tabela, e o estado dela é o `current_node_id`.
      const raiz = novaFrente(mundo, {
        organization_id: exec.organization_id,
        execution_id: exec.id,
        parent_frame_id: null,
        node_id: exec.current_node_id,
        status: "ready",
        next_eval_at: mundo.agora.toISOString(),
        steps_taken: exec.steps_taken,
        vars: {},
        fork_node_id: null,
      });
      return [{ ...raiz }];
    },
    criarFrentes: async (frentes) => frentes.map((f) => ({ ...novaFrente(mundo, f) })),
    atualizarFrente: async (id, _orgId, patch) => {
      const atual = mundo.frentes.get(id);
      if (atual === undefined) return;
      mundo.frentes.set(id, { ...atual, ...patch } as FrenteRow);
    },
    frentesVivas: async (executionId) =>
      [...mundo.frentes.values()].filter(
        (f) => f.execution_id === executionId && (f.status === "ready" || f.status === "waiting"),
      ).length,
    relerFrente: async (id) => {
      const f = mundo.frentes.get(id);
      return f === undefined ? null : { ...f };
    },
    relogioDasFrentesVivas: async (executionId) => {
      const relogios = [...mundo.frentes.values()]
        .filter(
          (f) =>
            f.execution_id === executionId &&
            (f.status === "ready" || f.status === "waiting") &&
            f.next_eval_at !== null,
        )
        .map((f) => f.next_eval_at!)
        .sort();
      return relogios[0] ?? null;
    },
    abrirEncontro: async (encontro) => {
      const chave = `${encontro.execution_id}:${encontro.fork_node_id}`;
      // `ignoreDuplicates` do upsert real: revisitar o fork num retry não pode
      // zerar a contagem de quem já chegou.
      if (mundo.encontros.has(chave)) return;
      mundo.encontros.set(chave, {
        ...encontro,
        chegadas: 0,
        resolvido_em: null,
      });
    },
    chegarNoEncontroSePreciso: async (input) => {
      const chave = `${input.execution_id}:${input.fork_node_id}`;
      const e = mundo.encontros.get(chave);
      if (e === undefined || e.join_node_id !== input.node_id) return null;
      // `least(chegadas + 1, esperadas)`, como a RPC: saturar mantém a linha
      // dentro do CHECK quando uma irmã em voo chega depois da corrida decidida.
      e.chegadas = Math.min(e.chegadas + 1, e.esperadas);
      return { modo: e.modo, esperadas: e.esperadas, chegadas: e.chegadas, resolvido_em: e.resolvido_em };
    },
    resolverEncontro: async (input) => {
      const e = mundo.encontros.get(`${input.execution_id}:${input.fork_node_id}`);
      if (e !== undefined && e.resolvido_em === null) e.resolvido_em = input.em;
    },
    cancelarFrentesIrmas: async (input) => {
      for (const [id, f] of mundo.frentes) {
        if (f.execution_id !== input.execution_id) continue;
        if (f.fork_node_id !== input.fork_node_id) continue;
        if (id === input.excetoFrenteId) continue;
        if (f.status !== "ready" && f.status !== "waiting") continue;
        mundo.frentes.set(id, { ...f, status: "cancelled", next_eval_at: null });
      }
    },
    carregarGlobais: async () => mundo.globais,
    avisarQueSubFluxoTerminou: async (input) => {
      mundo.avisosDeSubFluxo.push(input);
    },
    chamarSubFluxo: async (input) => {
      if (mundo.subFluxosPublicados.has(input.flow_id) === false) return null;
      const id = `exec-filha-${mundo.frentes.size + mundo.execucoes.size}`;
      mundo.execucoes.set(id, {
        ...execucaoNova(),
        id,
        flow_id: input.flow_id,
        input: input.input,
        parent_execution_id: input.parent_execution_id,
        parent_frame_id: input.parent_frame_id,
      });
      return { execution_id: id };
    },
    nomeDoFluxo: async () => "Fluxo de prova",
    abrirAvisoDeMorte: async (item) => {
      mundo.avisos.push({ titulo: item.titulo, corpo: item.corpo });
    },
  };

  const portas = (_exec: FlowExecutionRow): PortasDaExecucao => ({
    crm: {
      atribuirDono: async ({ leadId, userId }) => {
        mundo.atribuicoes.push({ leadId, userId });
      },
      removerDono: async () => {},
      adicionarTag: async ({ tag }) => {
        mundo.tags.push(tag);
      },
      houveRespostaDoDono: async () => mundo.donoRespondeu,
    },
    roteamento: { elegiveis: async () => mundo.elegiveis },
    canal: {
      enviarTexto: async ({ telefone, texto }) => {
        mundo.enviados.push({ telefone, texto });
        return mundo.desfechoDoEnvio;
      },
      enviarParaContato: async ({ contactId, tipo, texto, mediaUrl, channelSessionId }) => {
        mundo.enviadosAoCliente.push({ contactId, tipo, texto, mediaUrl, channelSessionId });
        return mundo.desfechoDoEnvio;
      },
    },

    disparo: {
      criar: async (pedido) => {
        mundo.disparosPedidos.push(pedido as unknown as Record<string, unknown>);
        return mundo.desfechoDoDisparo;
      },
    },
    avisos: {
      abrir: async ({ titulo, corpo }) => {
        mundo.avisos.push({ titulo, corpo });
      },
    },
  });

  return { db, relogio: () => mundo.agora, portas };
}

/** Avança o relógio do mundo. Nome próprio porque a data crua engana o leitor. */
export function avancarPara(mundo: Mundo, quando: Date): void {
  mundo.agora = quando;
  for (const [id, exec] of mundo.execucoes) {
    if (exec.next_eval_at === null) continue;
    if (Date.parse(exec.next_eval_at) > quando.getTime()) continue;
    mundo.execucoes.set(id, { ...exec, status: "pending" });
  }
}

/** O mundo pronto para uso, com os nós já registrados. */
export function criarMundoDeTeste(): MundoDeTeste {
  garantirNosRegistrados();
  const mundo = mundoNovo();
  const exec = execucaoNova();
  mundo.execucoes.set(exec.id, exec);
  return Object.assign(mundo, {
    montar: (grafo: FlowGraph) => montar(mundo, grafo),
    avancarPara: (quando: Date) => avancarPara(mundo, quando),
  });
}

export type MundoDeTeste = Mundo & {
  montar: (grafo: FlowGraph) => { db: FlowAdminClient; relogio: () => Date; portas: (e: FlowExecutionRow) => PortasDaExecucao };
  avancarPara: (quando: Date) => void;
};
