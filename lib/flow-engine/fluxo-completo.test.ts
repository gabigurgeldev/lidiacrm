/**
 * UM FLUXO SÓ, COM TODOS OS BLOCOS NOVOS, ANDANDO DE PONTA A PONTA.
 *
 * ## Por que este arquivo existe, sendo que cada bloco já tem teste
 *
 * Porque os testes por bloco provam a PEÇA e não a COSTURA. Cada um monta um
 * grafo mínimo de três nós e mede uma decisão. O que ninguém mede ali é o que o
 * cliente compra: um fluxo de verdade, com gatilho, decisão, paralelo, espera,
 * envio, distribuição, menu e fim — ligados, um alimentando o outro.
 *
 * Os defeitos que só aparecem aqui são os de contrato entre blocos:
 *
 *   - um bloco grava uma variável com nome que o seguinte não lê;
 *   - um ramo declarado não tem aresta e a execução morre no meio, em silêncio;
 *   - o dono escolhido e a vez da fila não sobrevivem à passagem de um bloco
 *     para o outro;
 *   - a espera de um bloco engole o resto do fluxo.
 *
 * ## O que este arquivo NÃO prova
 *
 * O adapter contra Supabase de verdade. Aqui as portas são o mundo falso — o
 * que se mede é o MOTOR e os BLOCOS. O SQL das migrations novas (0209, 0210,
 * 0211) é provado em `tests/invariants/`, contra Postgres real.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { rodarTickDeFluxos } from "./engine";
import type { FlowGraph } from "./graph-schema";
import { esquecerRegistroParaTeste, garantirNosRegistrados } from "./register-all";
import { limparRegistroParaTeste, tiposRegistrados } from "./registry";
import { criarMundoDeTeste, execucaoNova, type MundoDeTeste } from "./teste/mundo";

const pos = { x: 0, y: 0 };
const no = (id: string, type: string, config: unknown) => ({
  id,
  type,
  label: id,
  position: pos,
  config,
});
const ar = (id: string, source: string, target: string, branch_id = "else") => ({
  id,
  source,
  target,
  branch_id,
});

const ANA = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const BRUNO = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const CANAL = "cccccccc-3333-4333-8333-cccccccccccc";

/**
 * O fluxo de atendimento inteiro, como alguém montaria de verdade.
 *
 * Cliente manda mensagem → decide pelo score → (alto) fila indiana entrega a um
 * vendedor; em paralelo fala com o cliente e avisa o vendedor → reencontro →
 * pergunta com menu → a resposta escolhe o caminho → fim.
 * (baixo) → entrega para a IA → fim.
 */
function fluxoDeAtendimento(): FlowGraph {
  return {
    nodes: [
      no("inicio", "trigger.message_received", {}),
      no("decide", "logic.if", {
        saidas: [
          {
            id: "alto",
            label: "Lead quente",
            quando: { combinador: "and", itens: [{ campo: "lead.score", op: "gt", valor: 70 }] },
          },
        ],
      }),

      no("fila", "routing.fixed_order", {
        ordem: [ANA, BRUNO],
        quando_ninguem: "seguir_pelo_senao",
        tentar_de_novo_em_ms: 300_000,
      }),
      no("bifurca", "logic.fork", {
        ramos: [
          { id: "ao_cliente", label: "Falar com o cliente" },
          { id: "ao_vendedor", label: "Avisar o vendedor" },
        ],
        modo: "todas",
        encontro: "junta",
      }),
      no("manda_cliente", "whatsapp.send_to_lead", {
        tipo: "texto",
        texto: "Oi {{contact.name}}, um vendedor ja vai falar com voce.",
        canal_id: CANAL,
      }),
      no("avisa_vendedor", "whatsapp.notify_user", {
        destinatario: { tipo: "dono_do_lead" },
        mensagem: "Lead quente: {{lead.title}}",
      }),
      no("junta", "logic.merge", {}),
      no("pergunta", "whatsapp.send_to_lead", {
        tipo: "texto",
        texto: "Prefere falar agora (1) ou depois (2)?",
        canal_id: CANAL,
      }),
      no("menu", "logic.choice_menu", {
        opcoes: [
          { id: "agora", label: "Agora", aceita: ["1"] },
          { id: "depois", label: "Depois", aceita: ["2"] },
        ],
        modo: "exata",
        prazo_ms: 3_600_000,
      }),
      no("marca_agora", "crm.add_tag", { tag: "falar-agora" }),
      no("espera", "logic.wait", { duracao_ms: 300_000 }),
      no("marca_depois", "crm.add_tag", { tag: "falar-depois" }),
      no("marca_confuso", "crm.add_tag", { tag: "nao-entendeu" }),
      no("marca_calado", "crm.add_tag", { tag: "nao-respondeu" }),

      no("para_ia", "crm.handoff_to_agent", {}),

      no("fim", "logic.end", { desfecho: "atendido" }),
      no("fim_frio", "logic.end", { desfecho: "com_a_ia" }),
      no("fim_sem_vendedor", "logic.end", { desfecho: "sem_vendedor" }),
    ],
    edges: [
      ar("a1", "inicio", "decide"),
      ar("a2", "decide", "fila", "alto"),
      ar("a3", "decide", "para_ia", "else"),

      ar("a4", "fila", "bifurca"),
      ar("a5", "fila", "fim_sem_vendedor", "sem_ninguem"),
      ar("a6", "bifurca", "manda_cliente", "ao_cliente"),
      ar("a7", "bifurca", "avisa_vendedor", "ao_vendedor"),
      ar("a8", "manda_cliente", "junta"),
      ar("a9", "avisa_vendedor", "junta"),
      ar("a10", "junta", "pergunta"),
      ar("a11", "pergunta", "menu"),
      ar("a12", "menu", "marca_agora", "agora"),
      ar("a13", "menu", "espera", "depois"),
      ar("a14", "espera", "marca_depois"),
      ar("a15", "menu", "marca_confuso", "else"),
      ar("a16", "menu", "marca_calado", "nao_respondeu"),
      ar("a17", "marca_agora", "fim"),
      ar("a18", "marca_depois", "fim"),
      ar("a19", "marca_confuso", "fim"),
      ar("a20", "marca_calado", "fim"),
      ar("a21", "para_ia", "fim_frio"),

      // Saídas de exceção dos blocos de envio: sem estas arestas o fluxo morre
      // no meio quando o envio não sai, que é o defeito que este arquivo caça.
      ar("a22", "manda_cliente", "junta", "sem_contato"),
      ar("a23", "manda_cliente", "junta", "nao_saiu"),
      ar("a24", "avisa_vendedor", "junta", "sem_telefone"),
      ar("a25", "avisa_vendedor", "junta", "nao_saiu"),
      ar("a26", "pergunta", "menu", "sem_contato"),
      ar("a27", "pergunta", "menu", "nao_saiu"),
      ar("a28", "para_ia", "fim_frio", "sem_conversa"),
    ],
  };
}

let mundo: MundoDeTeste;

async function andar(deps: ReturnType<MundoDeTeste["montar"]>, tiques: number) {
  for (let i = 0; i < tiques; i += 1) await rodarTickDeFluxos(deps);
}

beforeEach(() => {
  limparRegistroParaTeste();
  esquecerRegistroParaTeste();
  garantirNosRegistrados();
  mundo = criarMundoDeTeste();
  mundo.elegiveis = [{ userId: ANA }, { userId: BRUNO }] as typeof mundo.elegiveis;
});

describe("o fluxo de atendimento inteiro", () => {
  it("controle: todo bloco do grafo é um tipo que o motor conhece", () => {
    // Sem este caso, um tipo escrito errado faria o fluxo morrer no primeiro
    // tique e os testes abaixo mediriam um grafo que nunca andou.
    const conhecidos = new Set(tiposRegistrados());
    for (const n of fluxoDeAtendimento().nodes) {
      expect(conhecidos, `${n.id}: tipo ${n.type} não está registrado`).toContain(n.type);
    }
  });

  it("⭐ lead quente: entrega ao vendedor, fala com o cliente, e para no menu", async () => {
    mundo.score = 85;
    const deps = mundo.montar(fluxoDeAtendimento());
    await andar(deps, 12);

    // A fila entregou — e ao PRIMEIRO da ordem, que é a vez dela.
    expect(mundo.atribuicoes.map((a) => a.userId)).toEqual([ANA]);
    // O cliente recebeu as duas mensagens (o aviso e a pergunta do menu).
    expect(mundo.enviadosAoCliente.map((e) => e.texto)).toEqual([
      "Oi Gabriel, um vendedor ja vai falar com voce.",
      "Prefere falar agora (1) ou depois (2)?",
    ]);
    // O vendedor recebeu o dele, pela porta de aviso — que é OUTRA porta.
    expect(mundo.enviados).toHaveLength(1);
    // E o fluxo está DORMINDO no menu, esperando a resposta.
    const exec = [...mundo.execucoes.values()][0]!;
    expect(exec.status).toBe("waiting");
  });

  it("⭐ lead frio vai para a IA, e NÃO consome vendedor nem manda mensagem", async () => {
    mundo.score = 20;
    const deps = mundo.montar(fluxoDeAtendimento());
    await andar(deps, 6);

    expect(mundo.devolvidasAoAgente).toEqual(["contato-1"]);
    expect(mundo.atribuicoes, "gastou um vendedor num lead frio").toHaveLength(0);
    expect(mundo.enviadosAoCliente, "mandou mensagem num caminho que era só da IA").toHaveLength(0);
    const exec = [...mundo.execucoes.values()][0]!;
    expect(exec.status).toBe("completed");
    expect(exec.outcome).toBe("com_a_ia");
  });

  it("sem vendedor disponível, o fluxo sai pela saída própria em vez de travar", async () => {
    mundo.score = 85;
    mundo.elegiveis = [];
    const deps = mundo.montar(fluxoDeAtendimento());
    await andar(deps, 6);

    const exec = [...mundo.execucoes.values()][0]!;
    expect(exec.outcome).toBe("sem_vendedor");
    expect(exec.status).toBe("completed");
  });

  it("⭐ o envio que NÃO sai não mata o fluxo — ele segue pela saída de exceção", async () => {
    // É o caso que separa um motor de automação de um script: o canal recusar
    // não pode deixar o lead parado para sempre sem ninguém saber.
    mundo.score = 85;
    mundo.desfechoDoEnvio = { kind: "recusado", motivo: "contato_bloqueado" };
    const deps = mundo.montar(fluxoDeAtendimento());
    await andar(deps, 12);

    const exec = [...mundo.execucoes.values()][0]!;
    expect(exec.status, "o fluxo travou porque o envio foi recusado").not.toBe("failed");
    expect(["waiting", "completed"]).toContain(exec.status);
  });

  it("⭐ dois leads seguidos: a fila indiana ANDA entre execuções", async () => {
    mundo.score = 85;
    await andar(mundo.montar(fluxoDeAtendimento()), 6);

    const segundo = execucaoNova();
    segundo.id = "exec-2";
    mundo.execucoes.set(segundo.id, segundo);
    await andar(mundo.montar(fluxoDeAtendimento()), 6);

    expect(
      mundo.atribuicoes.map((a) => a.userId),
      "a fila reiniciou e entregou os dois leads à mesma pessoa",
    ).toEqual([ANA, BRUNO]);
  });
});
