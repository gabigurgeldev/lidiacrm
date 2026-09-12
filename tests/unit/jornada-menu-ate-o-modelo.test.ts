/**
 * A JORNADA QUE O DONO DO PRODUTO DESCREVEU, PONTA A PONTA.
 *
 * "Quando escolho o 1, era pra enviar um template da API oficial, mas não
 * envia."
 *
 * Quatro consertos foram feitos no caminho do template sem que nenhum deles
 * fosse verificado contra a jornada inteira — porque ela não existia como
 * teste. Cada peça tinha o seu (o gatilho casa a palavra, o menu escolhe a
 * opção, o bloco manda o modelo à porta), e o vão entre elas não tinha nenhum.
 *
 * Este arquivo percorre o caminho completo no motor de verdade:
 *
 *   palavra-chave → pergunta ao cliente → menu espera → cliente responde "1"
 *   → o acordador real acorda a frente → o menu escolhe a opção
 *   → o bloco manda a DEFINIÇÃO APROVADA
 *
 * Se ele passa, o defeito do dono não está no motor: está na configuração do
 * fluxo dele, na conexão, ou na plataforma. Se ele falha, o defeito está aqui —
 * e é o que quatro rodadas de dedução não acharam.
 */
import { describe, expect, it } from "vitest";

import { acordarFrentesQueEsperam } from "@/lib/flow-engine/acordar-por-evento";
import { rodarTickDeFluxos } from "@/lib/flow-engine/engine";
import type { FrenteRow } from "@/lib/flow-engine/frentes";
import type { FlowGraph } from "@/lib/flow-engine/graph-schema";
import { criarMundoDeTeste, type MundoDeTeste } from "@/lib/flow-engine/teste/mundo";

const pos = { x: 0, y: 0 };
const no = (id: string, type: string, config: unknown) => ({ id, type, label: id, position: pos, config });
const aresta = (id: string, source: string, target: string, branch_id = "else") => ({
  id,
  source,
  target,
  branch_id,
});

const PALAVRA = "testedefluxopatrão";
const CONTATO = "contato-1";

/** O fluxo do dono: palavra → pergunta → menu → modelo aprovado. */
function fluxoDoDono(): FlowGraph {
  return {
    nodes: [
      no("inicio", "trigger.keyword", { palavras: [PALAVRA], modo: "exata", canal_id: null }),
      no("pergunta", "whatsapp.send_to_lead", {
        tipo: "texto",
        texto: "Escolha: 1 para orçamento",
        canal_id: null,
      }),
      no("menu", "logic.choice_menu", {
        opcoes: [{ id: "op1", label: "Orçamento", aceita: ["1"] }],
        modo: "exata",
        prazo_ms: 3_600_000,
      }),
      no("modelo", "whatsapp.send_to_lead", {
        tipo: "texto",
        texto: "",
        canal_id: null,
        modo: "template",
        modelo_nome: "confirmacao_pedido",
        modelo_idioma: "pt_BR",
        modelo_valores: { "1": "{{contact.name}}" },
      }),
    ],
    edges: [
      aresta("e1", "inicio", "pergunta"),
      aresta("e2", "pergunta", "menu"),
      aresta("e3", "menu", "modelo", "op1"),
    ],
  };
}

/**
 * Um Supabase de mentira apoiado no MUNDO — o acordador é o real.
 *
 * ⚠️ ELE PRECISA CONHECER AS DUAS TABELAS. A primeira versão deste falso
 * ignorava o nome da tabela e só sabia mexer em frentes — e com isso o update
 * que o acordador faz em `flow_executions` (pôr a execução de volta em
 * `pending`, com o relógio agora) sumia. O teste ficou vermelho acusando um
 * defeito que não existe no produto: a frente acordava e a execução continuava
 * dormindo até o prazo.
 *
 * Fica escrito porque a sonda cega é o modo de falha nº 1 deste tipo de teste —
 * e porque eu quase reportei o falso positivo como o defeito do dono.
 */
function adminSobreOMundo(mundo: MundoDeTeste) {
  const construtor = (tabela: string) => {
    const filtros: Record<string, unknown> = {};
    let patch: Record<string, unknown> | null = null;
    const eu = {
      select: () => eu,
      update: (p: Record<string, unknown>) => {
        patch = p;
        return eu;
      },
      eq: (col: string, val: unknown) => {
        filtros[col] = val;
        return eu;
      },
      in: (col: string, val: unknown) => {
        filtros[col] = val;
        return eu;
      },
      then: (resolve: (r: unknown) => void) => {
        if (patch !== null) {
          const id = String(filtros.id ?? "");
          if (tabela === "flow_executions") {
            const exec = mundo.execucoes.get(id);
            if (exec) mundo.execucoes.set(id, { ...exec, ...patch } as typeof exec);
          } else {
            const atual = mundo.frentes.get(id);
            if (atual) mundo.frentes.set(id, { ...atual, ...patch } as FrenteRow);
          }
          resolve({ data: null, error: null });
          return;
        }
        const esperando = [...mundo.frentes.values()].filter(
          (f) => f.status === "waiting" && f.awaiting_event_type === filtros.awaiting_event_type,
        );
        resolve({ data: esperando, error: null });
      },
    };
    return eu;
  };
  return { from: construtor } as never;
}

describe("a jornada inteira: palavra → menu → modelo aprovado", () => {
  it("⭐ escolher 1 manda a DEFINIÇÃO APROVADA", async () => {
    const mundo = criarMundoDeTeste();
    const grafo = fluxoDoDono();

    // ⚠️ O MUNDO ANDA NO RELÓGIO REAL, e isso não é detalhe de arranjo.
    //
    // O acordador carimba `new Date()` de verdade. Com o relógio fixo de 2026-08
    // do mundo, o prazo do menu (agora + 1h daquele fixo) já está no PASSADO
    // para o tempo real — e qualquer avanço do mundo torna a execução vencida
    // sozinha, sem o acordador ter feito nada.
    //
    // Foi o que aconteceu na primeira versão deste arquivo: remover o despertar
    // da execução do acordador deixava o teste VERDE. Ele provava o menu e o
    // template, e não provava a única coisa que só ele podia provar.
    const agora = new Date();
    mundo.agora = agora;
    mundo.execucoes.set("exec-1", {
      ...mundo.execucoes.get("exec-1")!,
      contact_id: CONTATO,
      next_eval_at: agora.toISOString(),
      input: { body_preview: PALAVRA, contact_id: CONTATO, direction: "inbound" },
    });

    await rodarTickDeFluxos(mundo.montar(grafo));

    // A pergunta saiu, e o fluxo parou no menu esperando a resposta.
    expect(mundo.enviadosAoCliente.map((e) => e.texto)).toEqual([
      "Escolha: 1 para orçamento",
    ]);
    const esperando = [...mundo.frentes.values()].filter((f) => f.status === "waiting");
    expect(esperando, "o fluxo não parou no menu").toHaveLength(1);
    expect(esperando[0]!.awaiting_event_type).toBe("message.received");
    expect(esperando[0]!.awaiting_match).toEqual({ contact_id: CONTATO });

    // ── 2. o cliente responde "1" ───────────────────────────────────────────
    // O acordador REAL, com o payload REAL do gatilho do banco.
    const r = await acordarFrentesQueEsperam(adminSobreOMundo(mundo), {
      id: "ev-2",
      organization_id: "org-1",
      event_type: "message.received",
      payload: {
        message_id: "msg-2",
        conversation_id: "conv-1",
        contact_id: CONTATO,
        direction: "inbound",
        type: "text",
        status: "received",
        external_id: null,
        channel_session_id: "canal-1",
        body_preview: "1",
      },
    });
    expect(r.status, "o acordador recusou o evento").toBe("ok");

    const acordada = [...mundo.frentes.values()].find((f) => f.status !== "waiting");
    expect(acordada, "a frente não foi acordada pela resposta").toBeDefined();

    // ── 3. o motor roda de novo e o menu escolhe a opção ────────────────────
    //
    // Um segundo depois. O prazo do menu é daqui a UMA HORA, então nada aqui
    // vence sozinho: a execução só é reclamada porque o acordador a pôs de volta
    // em `pending` com o relógio de agora. É essa a garantia do arquivo.
    mundo.agora = new Date(agora.getTime() + 1_000);
    await rodarTickDeFluxos(mundo.montar(grafo));

    const porModelo = mundo.enviadosAoCliente.filter((e) => e.modelo !== undefined);
    expect(porModelo, "o modelo aprovado NÃO foi mandado").toHaveLength(1);
    expect(porModelo[0]!.modelo).toEqual({
      nome: "confirmacao_pedido",
      idioma: "pt_BR",
      valores: { "1": "Gabriel" },
    });
  });
});
