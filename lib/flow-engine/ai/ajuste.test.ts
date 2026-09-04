/**
 * Ajustar é mexer no que foi pedido — e SÓ nisso.
 *
 * A asserção que carrega a feature não é "ficou mais barato": é que o bloco que
 * a pessoa ajustou à mão continua com o que ela pôs. Regerar a config de um
 * bloco intocado devolveria o que o modelo acha que ela deve ser, apagando o
 * texto que ela escreveu no editor — um "ajuste" que apaga trabalho é pior do
 * que não ter ajuste.
 */
import { describe, expect, it } from "vitest";

import { dividirOAjuste, juntarConfigs } from "./ajuste";
import { grafoParaPlano, intencaoDoBloco } from "./grafo-para-plano";
import type { PlanoDeFluxo } from "./plan-schema";
import type { ConfigResolvida } from "./plan-to-graph";
import type { FlowGraph } from "../graph-schema";

const GRAFO: FlowGraph = {
  nodes: [
    {
      id: "t1",
      type: "trigger.lead_created",
      label: "Lead novo",
      position: { x: 0, y: 0 },
      config: {},
    },
    {
      id: "espera",
      type: "logic.wait",
      label: "Esperar",
      position: { x: 260, y: 0 },
      config: { duracao_ms: 600_000 },
    },
    {
      id: "marca",
      type: "crm.add_tag",
      label: "Marcar o lead",
      position: { x: 520, y: 0 },
      // O valor que a pessoa digitou à mão. É este que não pode sumir.
      config: { tag: "vip-escrito-a-mao" },
    },
  ],
  edges: [
    { id: "e1", source: "t1", target: "espera", branch_id: "else" },
    { id: "e2", source: "espera", target: "marca", branch_id: "else" },
  ],
};

describe("o grafo descrito como plano", () => {
  it("carrega os valores da config na intenção — sem eles não há o que ajustar", () => {
    const { plano } = grafoParaPlano(GRAFO);
    const espera = plano.blocos.find((b) => b.id === "espera")!;

    expect(espera.intencao).toContain("600000");
    expect(plano.blocos.find((b) => b.id === "marca")!.intencao).toContain("vip-escrito-a-mao");
  });

  it("o pega-tudo não vira `ramo` — o plano já o trata como saída padrão", () => {
    const { plano } = grafoParaPlano(GRAFO);
    expect(plano.ligacoes.every((l) => l.ramo === undefined)).toBe(true);
  });

  it("a saída de REGRA vira o rótulo dela, não o id opaco", () => {
    const comRegra: FlowGraph = {
      nodes: [
        { id: "t", type: "trigger.lead_created", label: "T", position: { x: 0, y: 0 }, config: {} },
        {
          id: "decide",
          type: "logic.if",
          label: "Decidir",
          position: { x: 260, y: 0 },
          config: {
            saidas: [
              {
                id: "s1",
                label: "Score acima de 70",
                quando: { combinador: "and", itens: [{ campo: "lead.score", op: "gt", valor: 70 }] },
              },
            ],
          },
        },
        { id: "fim", type: "logic.end", label: "Fim", position: { x: 520, y: 0 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "t", target: "decide", branch_id: "else" },
        { id: "e2", source: "decide", target: "fim", branch_id: "s1" },
      ],
    };

    const { plano } = grafoParaPlano(comRegra);
    expect(plano.ligacoes.find((l) => l.de === "decide")!.ramo).toBe("Score acima de 70");
  });
});

describe("a divisão do ajuste", () => {
  const atual = grafoParaPlano(GRAFO);

  /** O plano que o modelo devolveria mudando SÓ a espera. */
  function planoComEsperaTrocada(): PlanoDeFluxo {
    return {
      blocos: atual.plano.blocos.map((b) =>
        b.id === "espera" ? { ...b, intencao: "Esperar (duracao_ms=3600000)" } : { ...b },
      ),
      ligacoes: atual.plano.ligacoes.map((l) => ({ ...l })),
    };
  }

  it("só o bloco tocado vai para a etapa 2", () => {
    const divisao = dividirOAjuste(planoComEsperaTrocada(), atual.configPorId, atual.intencaoPorId);

    expect(divisao.aGerar.blocos.map((b) => b.id)).toEqual(["espera"]);
    expect(divisao.idsPreservados).toEqual(["t1", "marca"]);
  });

  it("o que a pessoa escreveu à mão atravessa intacto", () => {
    const divisao = dividirOAjuste(planoComEsperaTrocada(), atual.configPorId, atual.intencaoPorId);

    expect(divisao.preservadas.get("marca")).toEqual({
      config: { tag: "vip-escrito-a-mao" },
      // `origem: "ia"` é o que faz `planoParaGrafo` aceitar a config como está,
      // em vez de trocá-la pelo exemplo do tipo.
      origem: "ia",
    });
  });

  it("as ligações vão inteiras — elas não custam chamada e dão contexto", () => {
    const divisao = dividirOAjuste(planoComEsperaTrocada(), atual.configPorId, atual.intencaoPorId);
    expect(divisao.aGerar.ligacoes).toHaveLength(2);
  });

  it("bloco NOVO não tem o que preservar, e vai gerar", () => {
    const plano: PlanoDeFluxo = {
      blocos: [
        ...atual.plano.blocos,
        { id: "avisa", tipo: "notify.internal", rotulo: "Avisar", intencao: "abre aviso" },
      ],
      ligacoes: [...atual.plano.ligacoes, { de: "marca", para: "avisa" }],
    };

    const divisao = dividirOAjuste(plano, atual.configPorId, atual.intencaoPorId);

    expect(divisao.aGerar.blocos.map((b) => b.id)).toEqual(["avisa"]);
    expect(divisao.idsPreservados).toHaveLength(3);
  });

  it("fluxo devolvido idêntico não paga chamada nenhuma de config", () => {
    const divisao = dividirOAjuste(atual.plano, atual.configPorId, atual.intencaoPorId);
    expect(divisao.aGerar.blocos).toEqual([]);
  });

  it("a intenção reconstruída é a MESMA fórmula dos dois lados", () => {
    // Se `grafoParaPlano` e `intencaoDoBloco` divergirem, tudo passa a parecer
    // "mudado" e o ajuste vira reescrita silenciosa — a economia some e a
    // config escrita à mão some junto.
    expect(atual.intencaoPorId.get("marca")).toBe(
      intencaoDoBloco("Marcar o lead", { tag: "vip-escrito-a-mao" }),
    );
  });
});

describe("juntar as configs", () => {
  it("o gerado ganha do preservado para o mesmo id", () => {
    const preservadas = new Map<string, ConfigResolvida>([
      ["a", { config: { x: 1 }, origem: "ia" }],
    ]);
    const geradas = new Map<string, ConfigResolvida>([["a", { config: { x: 2 }, origem: "ia" }]]);

    expect(juntarConfigs(preservadas, geradas).get("a")!.config).toEqual({ x: 2 });
  });
});
