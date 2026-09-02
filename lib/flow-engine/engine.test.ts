/**
 * O motor percorrendo A FATIA VERTICAL INTEIRA, com portas falsas.
 *
 * Não é um teste de unidade de `rodarTickDeFluxos`: é o fluxo que o produto
 * promete — lead novo, score, rodízio, aviso no WhatsApp, espera, "respondeu?",
 * redistribuição — rodando ponta a ponta sobre o grafo real, com as decisões
 * reais dos nós reais. O que fica de fora é só o Postgres e o WhatsApp.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  rodarTickDeFluxos,
  type FlowAdminClient,
  type FlowExecutionPatch,
  type FlowExecutionRow,
  type PortasDaExecucao,
} from "./engine";
import type { FlowGraph } from "./graph-schema";
import { esquecerRegistroParaTeste, garantirNosRegistrados } from "./register-all";
import { limparRegistroParaTeste } from "./registry";
import type { FrenteNova, FrenteRow } from "./frentes";
import type { AtendenteElegivel, DesfechoDeEnvio, FatosDaExecucao } from "./types";

const ORG = "org-1";
const LEAD = "lead-1";
const VERSAO = "versao-1";
const pos = { x: 0, y: 0 };

// ───────────────────────────── o grafo da fatia ──────────────────────────────

const CINCO_MINUTOS = 5 * 60_000;

function grafoDaFatia(): FlowGraph {
  const n = (id: string, type: string, config: unknown) => ({ id, type, label: id, position: pos, config });
  const a = (id: string, source: string, target: string, branch_id = "else") => ({ id, source, target, branch_id });
  return {
    nodes: [
      n("inicio", "trigger.lead_created", {}),
      n("score", "logic.if", {
        saidas: [
          {
            id: "alto",
            label: "Score acima de 70",
            quando: { combinador: "and", itens: [{ campo: "lead.score", op: "gt", valor: 70 }] },
          },
        ],
      }),
      n("rodizio", "routing.round_robin", { quando_ninguem: "tentar_depois", tentar_de_novo_em_ms: 300_000 }),
      n("avisa", "whatsapp.notify_user", {
        destinatario: { tipo: "dono_do_lead" },
        mensagem: "Novo lead: {{lead.title}} — score {{lead.score}}",
      }),
      n("espera", "logic.wait", { duracao_ms: CINCO_MINUTOS }),
      n("respondeu", "crm.owner_responded", { contar_a_partir_de: "desde_o_inicio_do_fluxo" }),
      n("passa_adiante", "routing.redistribute", { quando_ninguem: "seguir_pelo_senao", tentar_de_novo_em_ms: 300_000 }),
      n("avisa_gerente", "notify.internal", {
        titulo: "Lead sem atendimento",
        corpo: "O lead {{lead.title}} passou de vendedor sem ninguém responder.",
        severidade: "warn",
      }),
      n("fim_ok", "logic.end", { desfecho: "atendido" }),
      n("fim_frio", "logic.end", { desfecho: "nao_qualificado" }),
      n("fim_realocado", "logic.end", { desfecho: "realocado" }),
    ],
    edges: [
      a("e1", "inicio", "score"),
      a("e2", "score", "rodizio", "alto"),
      a("e3", "score", "fim_frio", "else"),
      a("e4", "rodizio", "avisa"),
      a("e5", "avisa", "espera"),
      a("e6", "avisa", "espera", "nao_saiu"),
      a("e7", "avisa", "espera", "sem_telefone"),
      a("e8", "espera", "respondeu"),
      a("e9", "respondeu", "fim_ok", "respondeu"),
      a("e10", "respondeu", "passa_adiante", "else"),
      a("e11", "passa_adiante", "avisa_gerente"),
      a("e12", "passa_adiante", "avisa_gerente", "sem_ninguem"),
      a("e13", "avisa_gerente", "fim_realocado"),
    ],
  };
}

// ───────────────────────────── o mundo de mentira ────────────────────────────

interface Mundo {
  execucoes: Map<string, FlowExecutionRow>;
  passos: Array<{ execution_id: string; node_id: string | null; event_type: string; payload: Record<string, unknown>; idempotency_key: string }>;
  esperas: Map<string, { desde: Date; ate: Date }>;
  atribuicoes: Array<{ leadId: string; userId: string }>;
  tags: string[];
  enviados: Array<{ telefone: string; texto: string }>;
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

function mundoNovo(): Mundo {
  return {
    execucoes: new Map(),
    passos: [],
    esperas: new Map(),
    atribuicoes: [],
    tags: [],
    enviados: [],
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
  };
}

function execucaoNova(): FlowExecutionRow {
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

function montar(mundo: Mundo, grafo: FlowGraph = grafoDaFatia()) {
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
      if (evento.event_type === "espera_iniciada") {
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
    },
    avisos: {
      abrir: async ({ titulo, corpo }) => {
        mundo.avisos.push({ titulo, corpo });
      },
    },
  });

  return { db, relogio: () => mundo.agora, portas };
}

// ──────────────────────────────── os testes ──────────────────────────────────

let mundo: Mundo;

beforeEach(() => {
  limparRegistroParaTeste();
  esquecerRegistroParaTeste();
  garantirNosRegistrados();
  mundo = mundoNovo();
  mundo.execucoes.set("exec-1", execucaoNova());
});

describe("a fatia vertical, ponta a ponta", () => {
  it("lead com score alto: distribui, avisa, e PARA na espera", async () => {
    const resumo = await rodarTickDeFluxos(montar(mundo));

    expect(resumo.reclamadas).toBe(1);
    expect(resumo.esperando).toBe(1);

    // Distribuiu para quem esperou MAIS (rodízio), não para o primeiro da lista.
    expect(mundo.atribuicoes).toEqual([{ leadId: LEAD, userId: "user-antigo" }]);

    // Avisou no telefone do vendedor, com as variáveis resolvidas.
    expect(mundo.enviados).toEqual([
      { telefone: "+5563999112061", texto: "Novo lead: Loja do Gabriel — score 82" },
    ]);

    // Parou no nó de espera, com relógio para daqui a 5 minutos.
    const exec = mundo.execucoes.get("exec-1")!;
    expect(exec.status).toBe("waiting");
    expect(exec.current_node_id).toBe("espera");
    expect(exec.next_eval_at).toBe("2026-08-30T12:05:00.000Z");

    // Um tick só percorreu quatro nós — não um por minuto.
    expect(mundo.passos.filter((p) => p.event_type === "no_avancou").map((p) => p.node_id)).toEqual([
      "inicio",
      "score",
      "rodizio",
      "avisa",
    ]);
  });

  it("lead com score baixo termina no ramo frio, sem distribuir nem avisar", async () => {
    mundo.score = 12;
    const resumo = await rodarTickDeFluxos(montar(mundo));

    expect(resumo.concluidas).toBe(1);
    expect(mundo.execucoes.get("exec-1")!.status).toBe("completed");
    expect(mundo.atribuicoes).toEqual([]);
    expect(mundo.enviados).toEqual([]);
  });

  it("lead SEM score ainda cai no ramo frio — ausência não é 'maior que 70'", async () => {
    // É o caso real: `crm_lead_scores` só é escrito depois de uma conversa, então
    // todo lead recém-criado chega aqui com score nulo.
    mundo.score = null;
    await rodarTickDeFluxos(montar(mundo));
    expect(mundo.execucoes.get("exec-1")!.status).toBe("completed");
    expect(mundo.enviados).toEqual([]);
  });

  it("passada a espera e SEM resposta: redistribui para o outro e avisa o gerente", async () => {
    await rodarTickDeFluxos(montar(mundo)); // até a espera
    mundo.agora = new Date("2026-08-30T12:06:00.000Z");

    const resumo = await rodarTickDeFluxos(montar(mundo));

    expect(resumo.concluidas).toBe(1);
    // Passou para o OUTRO vendedor: quem já foi tentado sai da lista.
    expect(mundo.atribuicoes.map((a) => a.userId)).toEqual(["user-antigo", "user-recente"]);
    expect(mundo.avisos.map((a) => a.titulo)).toEqual(["Lead sem atendimento"]);
    expect(mundo.avisos[0]!.corpo).toContain("Loja do Gabriel");
    expect(mundo.execucoes.get("exec-1")!.status).toBe("completed");
  });

  it("passada a espera e COM resposta: termina sem redistribuir", async () => {
    await rodarTickDeFluxos(montar(mundo));
    mundo.agora = new Date("2026-08-30T12:06:00.000Z");
    mundo.donoRespondeu = true;

    await rodarTickDeFluxos(montar(mundo));

    expect(mundo.atribuicoes.map((a) => a.userId)).toEqual(["user-antigo"]);
    expect(mundo.avisos).toEqual([]);
    expect(mundo.execucoes.get("exec-1")!.status).toBe("completed");
  });

  it("acordar ANTES da hora não reinicia a contagem da espera", async () => {
    // Sem isto, algo que acordasse a execução a cada 4 minutos faria a espera de
    // 5 nunca terminar.
    await rodarTickDeFluxos(montar(mundo));
    mundo.agora = new Date("2026-08-30T12:03:00.000Z");
    mundo.execucoes.get("exec-1")!.next_eval_at = "2026-08-30T12:03:00.000Z";

    await rodarTickDeFluxos(montar(mundo));

    const exec = mundo.execucoes.get("exec-1")!;
    expect(exec.status).toBe("waiting");
    expect(exec.next_eval_at).toBe("2026-08-30T12:05:00.000Z"); // a hora ORIGINAL
  });
});

describe("desfechos de envio", () => {
  it("mensagem que ficou na fila NÃO conta como avisada, e segue pelo ramo próprio", async () => {
    // O desfecho vem do ESTADO da mensagem, nunca da ausência de exceção.
    mundo.desfechoDoEnvio = { kind: "na_fila", motivo: "fora_da_janela" };
    await rodarTickDeFluxos(montar(mundo));

    const exec = mundo.execucoes.get("exec-1")!;
    expect(exec.status).toBe("waiting");
    expect(exec.context.aviso_na_fila_por).toBe("fora_da_janela");
    expect(exec.context.aviso_enviado_em).toBeUndefined();
  });

  it("vendedor sem telefone segue pelo ramo próprio, sem falhar o fluxo", async () => {
    mundo.telefoneDoDono = null;
    await rodarTickDeFluxos(montar(mundo));

    expect(mundo.enviados).toEqual([]);
    expect(mundo.execucoes.get("exec-1")!.status).toBe("waiting");
    expect(mundo.execucoes.get("exec-1")!.current_node_id).toBe("espera");
  });
});

describe("ninguém disponível", () => {
  it("o rodízio ESPERA em vez de falhar — fora de horário não é defeito", async () => {
    mundo.elegiveis = [];
    const resumo = await rodarTickDeFluxos(montar(mundo));

    expect(resumo.esperando).toBe(1);
    expect(resumo.falhadas).toBe(0);
    const exec = mundo.execucoes.get("exec-1")!;
    expect(exec.current_node_id).toBe("rodizio");
    expect(exec.next_eval_at).toBe("2026-08-30T12:05:00.000Z");
  });

  it("com 'seguir_pelo_senao', a redistribuição avisa o gerente mesmo sem ninguém", async () => {
    await rodarTickDeFluxos(montar(mundo));
    mundo.agora = new Date("2026-08-30T12:06:00.000Z");
    mundo.elegiveis = []; // todo mundo saiu do turno

    await rodarTickDeFluxos(montar(mundo));

    expect(mundo.avisos.map((a) => a.titulo)).toEqual(["Lead sem atendimento"]);
  });
});

describe("falhas", () => {
  it("porta que explode vira tentativa com backoff, não morte", async () => {
    const deps = montar(mundo);
    const portasQuebradas = () => {
      const p = deps.portas(execucaoNova());
      return { ...p, roteamento: { elegiveis: async () => { throw new Error("banco fora do ar"); } } };
    };
    const resumo = await rodarTickDeFluxos({ ...deps, portas: portasQuebradas });

    expect(resumo.falhadas).toBe(1);
    expect(resumo.mortas).toBe(0);
    const exec = mundo.execucoes.get("exec-1")!;
    expect(exec.status).toBe("pending");
    expect(exec.attempts).toBe(1);
    // Primeiro degrau do backoff: 30s.
    expect(exec.next_eval_at).toBe("2026-08-30T12:00:30.000Z");
  });

  it("na última tentativa morre E abre aviso na Central", async () => {
    // "Silenciosamente parou" é o pior desfecho de um motor de automação.
    mundo.execucoes.get("exec-1")!.attempts = 4;
    const deps = montar(mundo);
    const portasQuebradas = () => {
      const p = deps.portas(execucaoNova());
      return { ...p, roteamento: { elegiveis: async () => { throw new Error("banco fora do ar"); } } };
    };
    const resumo = await rodarTickDeFluxos({ ...deps, portas: portasQuebradas });

    expect(resumo.mortas).toBe(1);
    expect(mundo.execucoes.get("exec-1")!.status).toBe("dead");
    expect(mundo.avisos.map((a) => a.titulo)).toEqual(["Automação parou: Fluxo de prova"]);
  });

  it("grafo publicado ilegível mata sem gastar as 5 tentativas", async () => {
    const deps = montar(mundo);
    const resumo = await rodarTickDeFluxos({
      ...deps,
      db: { ...deps.db, carregarGrafo: async () => ({ nodes: "isto não é um grafo" }) },
    });

    expect(resumo.mortas).toBe(1);
    expect(resumo.falhadas).toBe(0);
    expect(mundo.execucoes.get("exec-1")!.status).toBe("dead");
  });

  it("uma execução podre não impede as outras do lote", async () => {
    mundo.execucoes.set("exec-2", { ...execucaoNova(), id: "exec-2" });
    const deps = montar(mundo);
    let primeira = true;
    const resumo = await rodarTickDeFluxos({
      ...deps,
      db: {
        ...deps.db,
        carregarGrafo: async (org, versao) => {
          if (primeira) {
            primeira = false;
            throw new Error("leitura falhou");
          }
          return deps.db.carregarGrafo(org, versao);
        },
      },
    });

    expect(resumo.reclamadas).toBe(2);
    expect(resumo.falhadas).toBe(1);
    expect(resumo.esperando).toBe(1);
  });

  it("claim que explode é DISTINGUÍVEL de 'não havia nada'", async () => {
    // Os dois produzem reclamadas: 0, e sem a marca o segundo esconde o primeiro.
    const deps = montar(mundo);
    const comFalha = await rodarTickDeFluxos({
      ...deps,
      db: { ...deps.db, reclamarVencidas: async () => { throw new Error("rpc fora"); } },
    });
    expect(comFalha).toMatchObject({ claim_falhou: true, reclamadas: 0 });

    mundo.execucoes.clear();
    const semNada = await rodarTickDeFluxos(montar(mundo));
    expect(semNada.claim_falhou).toBeUndefined();
    expect(semNada.reclamadas).toBe(0);
  });
});

describe("idempotência do passo", () => {
  it("visitar o MESMO nó duas vezes grava dois passos, não um replay engolido", async () => {
    // A chave inclui o número do passo justamente por isso: a redistribuição
    // volta ao rodízio, e uma chave só com o id do nó perderia a segunda visita.
    await rodarTickDeFluxos(montar(mundo));
    mundo.agora = new Date("2026-08-30T12:06:00.000Z");
    await rodarTickDeFluxos(montar(mundo));

    const chaves = mundo.passos.map((p) => p.idempotency_key);
    expect(new Set(chaves).size).toBe(chaves.length);
  });
});

describe("teto de passos", () => {
  it("execução que já bateu o teto morre em vez de rodar para sempre", async () => {
    mundo.execucoes.get("exec-1")!.steps_taken = 200;
    const resumo = await rodarTickDeFluxos(montar(mundo));
    expect(resumo.mortas).toBe(1);
    expect(mundo.execucoes.get("exec-1")!.status).toBe("dead");
  });
});

describe("controle negativo do próprio teste", () => {
  it("se o rodízio não filtrasse os já tentados, o segundo aviso iria para o MESMO vendedor", () => {
    // Prova que a asserção de redistribuição acima mede algo: com a lista de
    // excluídos vazia, o rodízio devolve de novo `user-antigo`.
    const semFiltro = [...mundo.elegiveis].sort((a, b) => a.lastAssignedAt! - b.lastAssignedAt!)[0]!;
    expect(semFiltro.userId).toBe("user-antigo");
    vi.clearAllMocks();
  });
});
