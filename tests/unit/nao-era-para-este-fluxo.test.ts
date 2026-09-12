/**
 * "NÃO ERA PARA ESTE FLUXO" DEIXOU DE SER ERRO.
 *
 * ─── O que o dono do produto viu ────────────────────────────────────────────
 *
 * Uma linha VERMELHA — "Parou com erro" — com o slug `mensagem_sem_a_palavra`
 * embaixo e `0 passos`. Não havia nada ali que dissesse se a mensagem
 * simplesmente não era daquele fluxo ou se o texto nunca tinha chegado ao
 * bloco. As duas telas são idênticas, e a segunda JÁ ACONTECEU neste repo:
 * durou porque ninguém conseguia distinguir uma da outra.
 *
 * Além da tela, cada mensagem que não casava abria um aviso na Central dizendo
 * "Automação parou". Numa instalação com cem mensagens por dia e um fluxo por
 * palavra, são cem alarmes falsos por dia — e o vermelho que importa chega no
 * meio deles.
 */
import { describe, expect, it } from "vitest";

import {
  diagnosticoDoMotivo,
  ehDesfechoEsperado,
  MOTIVOS_ESPERADOS,
} from "@/lib/flow-engine/desfecho-esperado";
import { motivoDeNaoCasar } from "@/lib/flow-engine/nodes/gatilhos-e-menu";

describe("o que conta como desfecho esperado", () => {
  it("⭐ casa por PREFIXO — o motivo carrega diagnóstico depois dos dois pontos", () => {
    // Comparar por igualdade voltaria a pintar de vermelho no dia em que o
    // diagnóstico entrasse, que é este mesmo commit.
    expect(ehDesfechoEsperado("mensagem_sem_a_palavra")).toBe(true);
    expect(ehDesfechoEsperado('mensagem_sem_a_palavra: recebi "oi"; …')).toBe(true);
  });

  it("⭐ a lista é CURTA: configuração faltando continua sendo erro", () => {
    // `sem_lead_para_atribuir`, `marcador_vazio`, `fila_sem_ninguem_na_ordem` são
    // dado ausente ou config errada — o operador precisa mesmo ser acordado.
    // Ampliar esta lista por conveniência apaga o alarme que importa.
    for (const motivo of [
      "sem_lead_para_atribuir",
      "marcador_vazio",
      "fila_sem_ninguem_na_ordem",
      "divisao_sem_caminhos",
      "grafo_invalido:config_invalida",
      "dono_invalido:vazio",
    ]) {
      expect(ehDesfechoEsperado(motivo), `${motivo} não pode ser tratado como normal`).toBe(false);
    }
    expect(MOTIVOS_ESPERADOS).toHaveLength(1);
  });

  it("nulo e vazio não são desfecho esperado", () => {
    expect(ehDesfechoEsperado(null)).toBe(false);
    expect(ehDesfechoEsperado(undefined)).toBe(false);
    expect(ehDesfechoEsperado("")).toBe(false);
  });

  it("o diagnóstico é o que vem depois dos dois pontos", () => {
    expect(diagnosticoDoMotivo("mensagem_sem_a_palavra: recebi nada")).toBe("recebi nada");
    expect(diagnosticoDoMotivo("sem_lead_para_atribuir")).toBe("");
  });
});

describe("o motivo que o gatilho por palavra escreve", () => {
  it("⭐ distingue 'não chegou texto' de 'chegou e não casou'", () => {
    // É a distinção inteira. Sem ela, o defeito de contrato (o texto não chegar)
    // é indistinguível do caso normal — e foi assim que ele durou.
    expect(motivoDeNaoCasar("", ["oi"], "contem")).toContain("recebi nenhum texto");
    expect(motivoDeNaoCasar("bom dia", ["oi"], "contem")).toContain('recebi "bom dia"');
  });

  it("⭐ diz QUAL comparação era, porque 'exata' é a confusão mais comum", () => {
    expect(motivoDeNaoCasar("oi, tudo bem?", ["oi"], "exata")).toContain(
      "a mensagem inteira tinha de ser",
    );
    expect(motivoDeNaoCasar("bom dia", ["oi"], "contem")).toContain("a mensagem tinha de conter");
  });

  it("⭐ acusa a config vazia em vez de listar nada", () => {
    // Palavras vazias é config quebrada, e o motivo tem de dizer isso — senão a
    // frase vira "esperava: " e o operador procura no lugar errado.
    expect(motivoDeNaoCasar("bom dia", [], "contem")).toContain("nenhuma palavra configurada");
  });

  it("o texto do cliente é CORTADO — o motivo é diagnóstico, não cópia da conversa", () => {
    const longo = "a".repeat(400);
    const motivo = motivoDeNaoCasar(longo, ["oi"], "contem");
    expect(motivo.length).toBeLessThan(300);
    expect(motivo).toContain("…");
  });

  it("continua começando pelo slug estável — é por ele que a tela reconhece", () => {
    expect(motivoDeNaoCasar("x", ["oi"], "contem").startsWith("mensagem_sem_a_palavra:")).toBe(true);
    expect(ehDesfechoEsperado(motivoDeNaoCasar("x", ["oi"], "contem"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

import { rodarTickDeFluxos } from "@/lib/flow-engine/engine";
import type { FlowGraph } from "@/lib/flow-engine/graph-schema";
import { criarMundoDeTeste } from "@/lib/flow-engine/teste/mundo";

const pos = { x: 0, y: 0 };

/** Um fluxo que começa por palavra e marca o lead quando ela vem. */
function grafoPorPalavra(): FlowGraph {
  return {
    nodes: [
      {
        id: "inicio",
        type: "trigger.keyword",
        label: "inicio",
        position: pos,
        config: { palavras: ["orçamento"], modo: "contem", canal_id: null },
      },
      { id: "marca", type: "crm.add_tag", label: "marca", position: pos, config: { tag: "veio" } },
    ],
    edges: [{ id: "e1", source: "inicio", target: "marca", branch_id: "else" }],
  };
}

describe("o motor não acorda ninguém por mensagem que não era do fluxo", () => {
  it("⭐ mensagem sem a palavra NÃO abre aviso na Central", async () => {
    // Um fluxo por palavra é armado por TODA mensagem que chega: o matcher não
    // lê a config do bloco. Avisar em cada uma enche a Central de "Automação
    // parou" e ensina o operador a ignorar o vermelho — o oposto do que aquele
    // aviso existe para fazer.
    const mundo = criarMundoDeTeste();
    mundo.execucoes.set("exec-1", {
      ...mundo.execucoes.get("exec-1")!,
      input: { body_preview: "bom dia" },
    });

    await rodarTickDeFluxos(mundo.montar(grafoPorPalavra()));

    expect(mundo.execucoes.get("exec-1")?.status).toBe("dead");
    expect(mundo.tags).toEqual([]);
    expect(mundo.avisos, "a Central não pode encher de alarme falso").toEqual([]);
  });

  it("⭐ e o motivo gravado carrega o diagnóstico, para a tela poder mostrá-lo", async () => {
    const mundo = criarMundoDeTeste();
    mundo.execucoes.set("exec-1", {
      ...mundo.execucoes.get("exec-1")!,
      input: { body_preview: "bom dia" },
    });

    await rodarTickDeFluxos(mundo.montar(grafoPorPalavra()));

    const erro = mundo.execucoes.get("exec-1")?.last_error ?? "";
    expect(ehDesfechoEsperado(erro)).toBe(true);
    expect(erro).toContain('recebi "bom dia"');
  });

  it("⭐ falha DE VERDADE continua abrindo aviso — o alarme não foi desligado", async () => {
    // A permissividade é só para o gatilho. Um bloco que morre por config
    // faltando precisa mesmo acordar alguém, e é isso que este caso protege.
    const mundo = criarMundoDeTeste();
    const grafo: FlowGraph = {
      nodes: [
        { id: "inicio", type: "trigger.lead_created", label: "inicio", position: pos, config: {} },
        {
          id: "fila",
          type: "routing.fixed_order",
          label: "fila",
          position: pos,
          config: { ordem: [], quando_ninguem: "tentar_depois", tentar_de_novo_em_ms: 300_000 },
        },
      ],
      edges: [{ id: "e1", source: "inicio", target: "fila", branch_id: "else" }],
    };

    await rodarTickDeFluxos(mundo.montar(grafo));

    expect(mundo.execucoes.get("exec-1")?.status).toBe("dead");
    expect(mundo.avisos.length, "config faltando TEM de acordar alguém").toBeGreaterThan(0);
  });
});
