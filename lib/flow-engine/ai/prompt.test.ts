/**
 * O PROMPT NÃO PODE DIVERGIR DO REGISTRY.
 *
 * ═══ O defeito que estas cercas existem para não repetir ═══
 *
 * `promptDePlano()` dizia, letra por letra:
 *
 *     - O primeiro bloco é sempre um gatilho (hoje só existe trigger.lead_created).
 *
 * Havia QUATRO gatilhos registrados. O manual gerado, dez linhas acima na mesma
 * string, listava os quatro corretamente — e a frase escrita à mão ao lado
 * mandava o modelo ignorar três. O sintoma ("a IA nunca escolhe o gatilho de
 * palavra-chave") lia como limitação do modelo, e não era: era o produto
 * informando ao modelo que o bloco não existia.
 *
 * A lição não é "corrigir a frase" — é que prosa escrita à mão ao lado de lista
 * gerada apodrece na primeira migration. Por isso o que se mede aqui é o TEXTO
 * PRODUZIDO contra o registry, e não a presença de uma frase específica.
 */
import { describe, expect, it } from "vitest";

import {
  planoComoTexto,
  promptDeConfig,
  promptDeCorrecao,
  promptDeInterpretacao,
  promptDePlano,
  tiposComRecursoExterno,
  tiposDeRamoDinamico,
} from "./prompt";
import { garantirNosRegistrados } from "../register-all";
import { todosOsNos, tiposRegistrados } from "../registry";
import { RAIZES_DE_VARIAVEL } from "../types";

function gatilhos(): string[] {
  garantirNosRegistrados();
  return todosOsNos()
    .filter((d) => d.category === "trigger")
    .map((d) => d.type);
}

describe("o prompt de plano fala do registry que existe", () => {
  it("cita TODOS os tipos registrados", () => {
    const texto = promptDePlano();
    const faltando = tiposRegistrados().filter((t) => !texto.includes(t));
    expect(faltando, `tipos ausentes do manual: ${faltando.join(", ")}`).toEqual([]);
  });

  it("cita TODOS os gatilhos na regra do primeiro bloco — não só um", () => {
    const texto = promptDePlano();
    // A regra vive depois do manual; medir a partir dali garante que a segunda
    // menção (a das regras) existe, e não só a do catálogo.
    const regras = texto.slice(texto.indexOf("Regras do plano"));
    const faltando = gatilhos().filter((t) => !regras.includes(t));
    expect(
      faltando,
      `a regra do primeiro bloco não menciona ${faltando.join(", ")} — ` +
        "é exatamente assim que o modelo passa a ignorar um gatilho que existe.",
    ).toEqual([]);
    expect(gatilhos().length, "esta cerca só mede se há mais de um gatilho").toBeGreaterThan(1);
  });

  it("não inventa nem ressuscita tipo de bloco nenhum", () => {
    const conhecidos = new Set(tiposRegistrados());
    for (const [nome, texto] of [
      ["plano", promptDePlano()],
      ["interpretação", promptDeInterpretacao()],
      ["correção", promptDeCorrecao(["algum erro"])],
    ] as const) {
      // O formato do registry é `categoria.acao` (vigiado por `registry.test.ts`).
      const citados = texto.match(/\b[a-z]+\.[a-z_]+\b/g) ?? [];
      const desconhecidos = [...new Set(citados)].filter(
        (t) => !conhecidos.has(t) && t.includes(".") && /^(trigger|logic|crm|whatsapp|routing|notify|flow)\./.test(t),
      );
      expect(
        desconhecidos,
        `o prompt de ${nome} cita ${desconhecidos.join(", ")}, que o registry não tem.`,
      ).toEqual([]);
    }
  });

  it("diz as saídas de cada bloco, com a marca de exceção", () => {
    const texto = promptDePlano();
    expect(texto).toContain("Saídas:");
    // Sem esta marca o modelo não distingue saída de REGRA (que a publicação
    // cobra) de saída de EXCEÇÃO (que pode ficar solta).
    expect(texto).toContain("[exceção — pode ficar solta]");
  });
});

describe("as listas derivadas encontram o que deveriam", () => {
  it("ramo dinâmico inclui os blocos cujas saídas saem da config", () => {
    const dinamicos = tiposDeRamoDinamico();
    expect(dinamicos).toContain("logic.if");
    expect(dinamicos).toContain("logic.choice_menu");
  });

  it("recurso externo inclui os blocos que nascem com UUID nulo", () => {
    const externos = tiposComRecursoExterno();
    expect(externos).toContain("flow.call");
    expect(externos).toContain("whatsapp.bulk_send");
    expect(externos).toContain("routing.fixed_order");
  });

  it("as duas listas aparecem na regra — derivadas, não digitadas", () => {
    const texto = promptDePlano();
    for (const tipo of [...tiposDeRamoDinamico(), ...tiposComRecursoExterno()]) {
      expect(texto, `${tipo} sumiu das regras`).toContain(tipo);
    }
  });
});

describe("a whitelist de variáveis é a do motor", () => {
  it("autoriza todas as raízes do escopo, e nomeia cada uma", () => {
    const texto = promptDeConfig("crm.add_tag", "Marcar o lead", "põe um marcador");
    for (const raiz of Object.keys(RAIZES_DE_VARIAVEL)) {
      expect(texto, `{{${raiz}.…}} não está autorizado no prompt`).toContain(`{{${raiz}.`);
    }
  });

  it("lista os operadores de condição que o motor conhece", () => {
    const texto = promptDeConfig("logic.if", "Decidir", "escolhe caminho");
    expect(texto).toContain("gt");
    expect(texto).toContain("contains");
  });
});

describe("a correção recebe os erros e o plano", () => {
  it("nomeia cada erro recebido", () => {
    const texto = promptDeCorrecao(['A saída "Sim" não leva a lugar nenhum.']);
    expect(texto).toContain('A saída "Sim" não leva a lugar nenhum.');
  });

  it("descreve o plano de um jeito que o modelo consegue reescrever", () => {
    const texto = planoComoTexto({
      blocos: [{ id: "n1", tipo: "logic.wait", rotulo: "Esperar", intencao: "espera 10 min" }],
      ligacoes: [{ de: "n1", para: "n2", ramo: "Depois da espera" }],
    });
    expect(texto).toContain("n1 (logic.wait)");
    expect(texto).toContain('n1 -> n2 pela saída "Depois da espera"');
  });
});
