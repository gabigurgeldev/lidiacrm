/**
 * O MOTIVO DA RECUSA CHEGA À TELA — e por que isso é o defeito, não o conforto.
 *
 * ─── O que custou ───────────────────────────────────────────────────────────
 *
 * O bloco de envio ao cliente NÃO mata a execução quando a mensagem não sai:
 * segue pela saída "Não saiu agora" e grava o motivo em `vars`. Correto — o
 * resto do fluxo costuma continuar fazendo sentido.
 *
 * Mas o motivo morria ali. O passo gravado levava `{ramo, proximo}` e mais nada,
 * e a trilha desenhava só o nome do passo e o id do bloco. O dono do produto
 * reportou "não funcionou" três vezes sem ter o que anexar, e eu consertei três
 * causas plausíveis diferentes sem nunca ver o erro real.
 *
 * ─── A cerca que não pode cair ──────────────────────────────────────────────
 *
 * `flow_execution_events.payload` NÃO é limpo pela cascata de anonimização da
 * LGPD (a migration 0208 alcança `flow_executions` e `flow_execution_frames`, e
 * para aí). Por isso só entra diagnóstico que o SISTEMA escreveu — nunca texto
 * do cliente. O caso do `menu_resposta` abaixo é o que guarda isso.
 */
import { describe, expect, it } from "vitest";

import { rodarTickDeFluxos } from "@/lib/flow-engine/engine";
import type { FlowGraph } from "@/lib/flow-engine/graph-schema";
import {
  CHAVES_DE_DIAGNOSTICO,
  diagnosticoDasVars,
  diagnosticosDoPayload,
} from "@/lib/flow-engine/diagnostico-do-passo";
import { criarMundoDeTeste } from "@/lib/flow-engine/teste/mundo";

describe("o que pode ir para o passo", () => {
  it("⭐ NENHUMA chave de diagnóstico carrega texto do cliente", () => {
    // O payload do passo sobrevive à anonimização. `menu_resposta` é o que a
    // pessoa escreveu; `ultima_mensagem_id` e `dono_escolhido` são ponteiros
    // para dados dela. Nenhum pode entrar — e esta é a cerca.
    for (const proibida of [
      "menu_resposta",
      "menu_escolha",
      "ultima_mensagem_id",
      "dono_escolhido",
      "fila_posicao",
    ]) {
      expect(CHAVES_DE_DIAGNOSTICO as readonly string[]).not.toContain(proibida);
    }
  });

  it("⭐ leva o motivo da recusa e descarta o resto", () => {
    expect(
      diagnosticoDasVars({
        envio_recusado: "meta_132001: template name does not exist",
        menu_resposta: "quero falar com um humano",
        ultima_mensagem_id: "msg-1",
      }),
    ).toEqual({ envio_recusado: "meta_132001: template name does not exist" });
  });

  it("número e booleano entram como texto — perder o sinal pelo tipo é o mesmo defeito", () => {
    expect(diagnosticoDasVars({ envio_na_fila: 3 })).toEqual({ envio_na_fila: "3" });
    expect(diagnosticoDasVars(undefined)).toEqual({});
    expect(diagnosticoDasVars({ envio_recusado: "   " })).toEqual({});
  });

  it("a tela recebe rótulo legível junto do motivo cru", () => {
    const [d] = diagnosticosDoPayload({ ramo: "nao_saiu", envio_recusado: "meta_133010" });
    expect(d).toEqual({
      chave: "envio_recusado",
      rotulo: "A mensagem não saiu",
      motivo: "meta_133010",
    });
    expect(diagnosticosDoPayload({ ramo: "else" })).toEqual([]);
    expect(diagnosticosDoPayload(null)).toEqual([]);
  });
});

describe("o motor grava o motivo no passo", () => {
  it("⭐ envio recusado deixa rastro NO PASSO, não só no contexto", async () => {
    const mundo = criarMundoDeTeste();
    mundo.desfechoDoEnvio = { kind: "recusado", motivo: "meta_132001: template not found" };

    const grafo: FlowGraph = {
      nodes: [
        {
          id: "inicio",
          type: "trigger.lead_created",
          label: "inicio",
          position: { x: 0, y: 0 },
          config: {},
        },
        {
          id: "manda",
          type: "whatsapp.send_to_lead",
          label: "manda",
          position: { x: 0, y: 0 },
          config: {
            tipo: "texto",
            texto: "",
            canal_id: null,
            modo: "template",
            modelo_nome: "confirmacao",
            modelo_idioma: "pt_BR",
            modelo_valores: {},
          },
        },
      ],
      edges: [{ id: "e1", source: "inicio", target: "manda", branch_id: "else" }],
    };

    await rodarTickDeFluxos(mundo.montar(grafo));

    const passo = mundo.passos.find((p) => p.node_id === "manda" && p.event_type === "no_avancou");
    expect(passo, "o passo do envio nem foi registrado").toBeDefined();
    expect(passo!.payload.envio_recusado).toBe("meta_132001: template not found");
    // E o diagnóstico sobrevive à travessia até a tela.
    expect(diagnosticosDoPayload(passo!.payload)[0]?.motivo).toContain("132001");
  });

  it("⭐ envio que deu certo NÃO polui o passo com diagnóstico", async () => {
    const mundo = criarMundoDeTeste();
    const grafo: FlowGraph = {
      nodes: [
        {
          id: "inicio",
          type: "trigger.lead_created",
          label: "inicio",
          position: { x: 0, y: 0 },
          config: {},
        },
        {
          id: "manda",
          type: "whatsapp.send_to_lead",
          label: "manda",
          position: { x: 0, y: 0 },
          config: { tipo: "texto", texto: "Oi!", canal_id: null },
        },
      ],
      edges: [{ id: "e1", source: "inicio", target: "manda", branch_id: "else" }],
    };

    await rodarTickDeFluxos(mundo.montar(grafo));

    const passo = mundo.passos.find((p) => p.node_id === "manda" && p.event_type === "no_avancou");
    expect(diagnosticosDoPayload(passo!.payload)).toEqual([]);
    // `ultima_mensagem_id` é ponteiro para dado da pessoa e NÃO pode vazar aqui.
    expect(passo!.payload.ultima_mensagem_id).toBeUndefined();
  });
});
