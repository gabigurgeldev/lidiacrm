/**
 * A JORNADA DA ENQUETE NO MOTOR DE VERDADE.
 *
 *   palavra-chave → o menu manda a pergunta COMO ENQUETE → espera
 *   → o voto volta (como o ingest o grava: texto com o rótulo da opção)
 *   → o acordador real acorda a frente → o menu escolhe o ramo do rótulo
 *
 * As peças têm testes próprios (o ingest grava o rótulo, o menu casa o rótulo);
 * este arquivo é o vão entre elas — o mesmo tipo de vão que
 * `jornada-menu-ate-o-modelo.test.ts` existe para fechar.
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

const PALAVRA = "menu";
const CONTATO = "contato-1";

function fluxo(): FlowGraph {
  return {
    nodes: [
      no("inicio", "trigger.keyword", { palavras: [PALAVRA], modo: "exata", canal_id: null }),
      no("menu", "logic.choice_menu", {
        pergunta: "Qual setor?",
        formato: "enquete",
        opcoes: [
          { id: "vendas", label: "Falar com vendas", aceita: ["vendas"] },
          { id: "suporte", label: "Suporte técnico", aceita: ["suporte"] },
        ],
        modo: "exata",
        prazo_ms: 3_600_000,
      }),
      no("resposta_suporte", "whatsapp.send_to_lead", {
        tipo: "texto",
        texto: "Já te passo para o suporte.",
        canal_id: null,
      }),
    ],
    edges: [aresta("e1", "inicio", "menu"), aresta("e2", "menu", "resposta_suporte", "suporte")],
  };
}

/** Mesmo falso de `jornada-menu-ate-o-modelo.test.ts`: conhece as duas tabelas. */
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

describe("a jornada da enquete: pergunta → voto → ramo", () => {
  it("⭐ o voto em 'Suporte técnico' segue pela saída do suporte", async () => {
    const mundo = criarMundoDeTeste();
    const grafo = fluxo();
    // Relógio real: ver o porquê em `jornada-menu-ate-o-modelo.test.ts`.
    const agora = new Date();
    mundo.agora = agora;
    mundo.execucoes.set("exec-1", {
      ...mundo.execucoes.get("exec-1")!,
      contact_id: CONTATO,
      next_eval_at: agora.toISOString(),
      input: { body_preview: PALAVRA, contact_id: CONTATO, direction: "inbound" },
    });

    await rodarTickDeFluxos(mundo.montar(grafo));

    // ── 1. a pergunta saiu como opções tocáveis ─────────────────────────────
    expect(mundo.enviadosAoCliente).toHaveLength(1);
    expect(mundo.enviadosAoCliente[0]!.opcoes).toEqual({
      formato: "enquete",
      pergunta: "Qual setor?",
      opcoes: [
        { id: "vendas", label: "Falar com vendas" },
        { id: "suporte", label: "Suporte técnico" },
      ],
    });

    // ── 2. o voto volta como o ingest o grava: texto com o rótulo ───────────
    const r = await acordarFrentesQueEsperam(adminSobreOMundo(mundo), {
      id: "ev-2",
      organization_id: "org-1",
      event_type: "message.received",
      payload: {
        message_id: "msg-voto",
        conversation_id: "conv-1",
        contact_id: CONTATO,
        direction: "inbound",
        type: "text",
        status: "delivered",
        external_id: "false_5531999998888@c.us_VOTO1",
        channel_session_id: "canal-1",
        body_preview: "Suporte técnico",
      },
    });
    expect(r.status, "o acordador recusou o evento").toBe("ok");

    // ── 3. o menu escolhe o ramo do rótulo ──────────────────────────────────
    mundo.agora = new Date(agora.getTime() + 1_000);
    await rodarTickDeFluxos(mundo.montar(grafo));

    expect(mundo.enviadosAoCliente.map((e) => e.texto)).toContain("Já te passo para o suporte.");
  });
});
