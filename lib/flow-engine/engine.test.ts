/**
 * O motor percorrendo A FATIA VERTICAL INTEIRA, com portas falsas.
 *
 * Não é um teste de unidade de `rodarTickDeFluxos`: é o fluxo que o produto
 * promete — lead novo, score, rodízio, aviso no WhatsApp, espera, "respondeu?",
 * redistribuição — rodando ponta a ponta sobre o grafo real, com as decisões
 * reais dos nós reais. O que fica de fora é só o Postgres e o WhatsApp.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { rodarTickDeFluxos } from "./engine";
import type { FlowGraph } from "./graph-schema";
import { esquecerRegistroParaTeste, garantirNosRegistrados } from "./register-all";
import { limparRegistroParaTeste } from "./registry";
import {
  execucaoNova,
  montar as montarBase,
  mundoNovo as mundoBaseNovo,
  type Mundo as MundoBase,
} from "./teste/mundo";

const LEAD = "lead-1";
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

// O mundo falso mora em `teste/mundo.ts`: `paralelo.test.ts` usa o MESMO.
// Duas cópias divergiriam no primeiro conserto, e a que não o recebesse
// seguiria verde provando um motor que não existe mais.
type Mundo = MundoBase;
const mundoNovo = () => { const m = mundoBaseNovo(); const e = execucaoNova(); m.execucoes.set(e.id, e); return m; };
const montar = (mundo: Mundo, grafo: FlowGraph = grafoDaFatia()) => montarBase(mundo, grafo);

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
