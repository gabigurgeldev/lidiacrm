/**
 * O SEGUNDO MENU NÃO LÊ A RESPOSTA DO PRIMEIRO.
 *
 * O acordador grava o payload da resposta em `vars.evento` da frente, e nada o
 * apagava: a espera seguinte nascia carregando o evento VELHO. Um segundo menu
 * que vencesse pelo prazo ("o cliente sumiu") encontrava aquele evento e lia
 * "chegou resposta" — seguindo por "não entendi" com o texto do primeiro menu,
 * em vez de "não respondeu a tempo".
 *
 * Numa pré-triagem (nome → sistema → problema) isso é o caso comum, não o raro.
 */
import { describe, expect, it } from "vitest";

import { acordarFrentesQueEsperam } from "@/lib/flow-engine/acordar-por-evento";
import { rodarTickDeFluxos } from "@/lib/flow-engine/engine";
import type { FrenteRow } from "@/lib/flow-engine/frentes";
import type { FlowGraph } from "@/lib/flow-engine/graph-schema";
import { criarMundoDeTeste, type MundoDeTeste } from "@/lib/flow-engine/teste/mundo";

const pos = { x: 0, y: 0 };
const no = (id: string, type: string, config: unknown) => ({ id, type, label: id, position: pos, config });
const aresta = (id: string, source: string, target: string, branch_id = "else") => ({ id, source, target, branch_id });
const envia = (id: string, texto: string) => no(id, "whatsapp.send_to_lead", { tipo: "texto", texto, canal_id: null });

const CONTATO = "contato-1";
const CINCO_MIN = 5 * 60_000;

function triagem(): FlowGraph {
  return {
    nodes: [
      no("inicio", "trigger.keyword", { palavras: ["oi"], modo: "exata", canal_id: null }),
      envia("p1", "1️⃣ Suporte"),
      no("menu1", "logic.choice_menu", {
        opcoes: [{ id: "suporte", label: "Suporte", aceita: ["1"] }],
        modo: "exata",
        prazo_ms: CINCO_MIN,
      }),
      envia("p2", "Qual sistema? a) ERP"),
      no("menu2", "logic.choice_menu", {
        opcoes: [{ id: "erp", label: "ERP", aceita: ["a"] }],
        modo: "exata",
        prazo_ms: CINCO_MIN,
      }),
      envia("escolheu", "ESCOLHEU_ERP"),
      envia("naoEntendi", "NAO_ENTENDI"),
      envia("semResposta", "SEM_RESPOSTA"),
    ],
    edges: [
      aresta("e1", "inicio", "p1"),
      aresta("e2", "p1", "menu1"),
      aresta("e3", "menu1", "p2", "suporte"),
      aresta("e4", "p2", "menu2"),
      aresta("e5", "menu2", "escolheu", "erp"),
      aresta("e6", "menu2", "naoEntendi", "else"),
      aresta("e7", "menu2", "semResposta", "nao_respondeu"),
    ],
  };
}

/** Supabase de mentira sobre o mundo — mesmo falso de `jornada-menu-ate-o-modelo.test.ts`. */
function adminSobreOMundo(mundo: MundoDeTeste) {
  const construtor = (tabela: string) => {
    const filtros: Record<string, unknown> = {};
    let patch: Record<string, unknown> | null = null;
    const eu = {
      select: () => eu,
      update: (p: Record<string, unknown>) => ((patch = p), eu),
      eq: (col: string, val: unknown) => ((filtros[col] = val), eu),
      in: (col: string, val: unknown) => ((filtros[col] = val), eu),
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
        resolve({
          data: [...mundo.frentes.values()].filter(
            (f) => f.status === "waiting" && f.awaiting_event_type === filtros.awaiting_event_type,
          ),
          error: null,
        });
      },
    };
    return eu;
  };
  return { from: construtor } as never;
}

describe("menu seguinte que vence pelo prazo", () => {
  it("segue por 'não respondeu', e não pela resposta do menu anterior", async () => {
    const mundo = criarMundoDeTeste();
    const grafo = triagem();
    const agora = new Date();
    mundo.agora = agora;
    mundo.execucoes.set("exec-1", {
      ...mundo.execucoes.get("exec-1")!,
      contact_id: CONTATO,
      next_eval_at: agora.toISOString(),
      input: { body_preview: "oi", contact_id: CONTATO, direction: "inbound" },
    });

    await rodarTickDeFluxos(mundo.montar(grafo));

    // O cliente responde "1" ao primeiro menu.
    await acordarFrentesQueEsperam(adminSobreOMundo(mundo), {
      id: "ev-2",
      organization_id: "org-1",
      event_type: "message.received",
      payload: { message_id: "msg-2", conversation_id: "conv-1", contact_id: CONTATO, direction: "inbound", body_preview: "1" },
    });
    mundo.agora = new Date(agora.getTime() + 1_000);
    await rodarTickDeFluxos(mundo.montar(grafo));

    expect(mundo.enviadosAoCliente.map((e) => e.texto)).toEqual(["1️⃣ Suporte", "Qual sistema? a) ERP"]);
    const esperando = [...mundo.frentes.values()].filter((f) => f.status === "waiting");
    expect(esperando).toHaveLength(1);
    expect(esperando[0]!.vars.evento, "a espera do segundo menu nasceu com o evento do primeiro").toBeUndefined();

    // O cliente some: o segundo menu vence pelo prazo.
    mundo.agora = new Date(agora.getTime() + 2 * CINCO_MIN);
    const exec = mundo.execucoes.get("exec-1")!;
    mundo.execucoes.set("exec-1", { ...exec, next_eval_at: new Date(agora.getTime() + CINCO_MIN + 2_000).toISOString() });
    await rodarTickDeFluxos(mundo.montar(grafo));

    const textos = mundo.enviadosAoCliente.map((e) => e.texto);
    expect(textos, "o segundo menu leu a resposta do primeiro").not.toContain("NAO_ENTENDI");
    expect(textos).toContain("SEM_RESPOSTA");
  });
});
