import { describe, expect, it } from "vitest";

import { SECOES_OBRIGATORIAS } from "./doutrina";
import { todosOsExemplares } from "./exemplar";
import { pedidoDeCorrecao, verificarPrompt, type Achado } from "./verificacao";

/**
 * Cada regra tem uma sabotagem: parte de um prompt limpo (o exemplar), estraga
 * uma coisa e confere que SÓ aquela regra acende. Guarda de vacuidade: o
 * exemplar limpo sai sem nenhum erro — senão todo teste "acende" por acaso.
 */
const LIMPO = todosOsExemplares()[0]!.texto;
const FONTE = LIMPO; // o exemplar é a própria fonte dos fatos dele
const TODOS = ["atender", "vender", "reter", "escalar", "organizar", "evoluir"] as const;

const regras = (achados: Achado[], nivel?: Achado["nivel"]) =>
  achados.filter((a) => nivel === undefined || a.nivel === nivel).map((a) => a.regra);

describe("verificarPrompt", () => {
  it("guarda de vacuidade: todo exemplar sai sem erro", () => {
    for (const { id, texto } of todosOsExemplares()) {
      expect(regras(verificarPrompt({ prompt: texto, fonte: texto, pacotes: TODOS }), "erro"), id).toEqual([]);
    }
  });

  it("os exemplares usam exatamente as seções obrigatórias", () => {
    for (const { texto } of todosOsExemplares()) {
      for (const s of SECOES_OBRIGATORIAS) expect(texto.split("\n")).toContain(`${s}:`);
    }
  });

  it("seção faltando é erro", () => {
    const sem = LIMPO.replace("Quando chamar uma pessoa:", "Escalonamento:");
    expect(regras(verificarPrompt({ prompt: sem, fonte: FONTE, pacotes: TODOS }), "erro")).toContain("secao_faltando");
  });

  it("preço que não está no que o dono contou é erro (fato inventado)", () => {
    const comPreco = LIMPO.replace("Marcar a aula experimental gratuita", "Marcar a aula experimental por R$ 49,90");
    const achados = verificarPrompt({ prompt: comPreco, fonte: FONTE, pacotes: TODOS });
    expect(achados.find((a) => a.regra === "fato_inventado")?.trecho).toBe("R$ 49,90");
    // e o mesmo preço, quando está na fonte, passa
    expect(regras(verificarPrompt({ prompt: comPreco, fonte: `${FONTE}\nAula avulsa: R$ 49,90`, pacotes: TODOS }))).not.toContain(
      "fato_inventado",
    );
  });

  it("porcentagem, telefone e site inventados também são erro", () => {
    const p = `${LIMPO}\nDesconto de 15% à vista. Ligue (48) 99876-5432 ou veja www.studioequilibrio.com.br`;
    const trechos = verificarPrompt({ prompt: p, fonte: FONTE, pacotes: TODOS })
      .filter((a) => a.regra === "fato_inventado")
      .map((a) => a.trecho);
    expect(trechos).toEqual(expect.arrayContaining(["15%", "(48) 99876-5432", "www.studioequilibrio.com.br"]));
  });

  it("valor com milhar escrito diferente na fonte não é falso positivo", () => {
    const p = LIMPO.replace("Marcar a aula experimental gratuita", "Plano anual R$ 1.200,00");
    expect(regras(verificarPrompt({ prompt: p, fonte: `${FONTE} plano anual 1200 reais`, pacotes: TODOS }))).not.toContain(
      "fato_inventado",
    );
  });

  it("título com # ou tabela é erro", () => {
    expect(regras(verificarPrompt({ prompt: `# Agente\n${LIMPO}`, fonte: FONTE, pacotes: TODOS }), "erro")).toContain("markdown");
    expect(regras(verificarPrompt({ prompt: `${LIMPO}\n| a | b |\n|---|---|`, fonte: FONTE, pacotes: TODOS }), "erro")).toContain(
      "markdown",
    );
  });

  it("sem exemplo de conversa é erro; poucos é aviso", () => {
    const corte = LIMPO.slice(0, LIMPO.indexOf("Cliente:"));
    expect(regras(verificarPrompt({ prompt: corte, fonte: FONTE, pacotes: TODOS }), "erro")).toContain("exemplos");
    const dois = LIMPO.slice(0, LIMPO.indexOf("Cliente: achei caro"));
    expect(regras(verificarPrompt({ prompt: dois, fonte: FONTE, pacotes: TODOS }), "aviso")).toContain("exemplos");
  });

  it("proibição sem alternativa é aviso", () => {
    const p = `${LIMPO}\n- Nunca fale de política.`;
    expect(regras(verificarPrompt({ prompt: p, fonte: FONTE, pacotes: TODOS }), "aviso")).toContain("proibicao_sem_alternativa");
  });

  it("excesso de maiúsculas é aviso; siglas não contam", () => {
    const grito = `${LIMPO}\nSEMPRE SEJA EDUCADA MUITO EDUCADA SEMPRE MESMO ATENTA RAPIDA CLARA`;
    expect(regras(verificarPrompt({ prompt: grito, fonte: FONTE, pacotes: TODOS }))).toContain("maiusculas");
    const siglas = `${LIMPO}\nLGPD CDC CFM SAMU CPF CNPJ FAQ PIX FGTS`;
    expect(regras(verificarPrompt({ prompt: siglas, fonte: FONTE, pacotes: TODOS }))).not.toContain("maiusculas");
  });

  it("'nunca' e 'sempre' sobre o mesmo termo sensível é aviso de contradição", () => {
    const p = `${LIMPO}\n- Nunca envie link de pagamento.\n- Sempre envie o link de pagamento no fim.`;
    expect(regras(verificarPrompt({ prompt: p, fonte: FONTE, pacotes: TODOS }))).toContain("contradicao");
  });

  it("mandar passar para uma pessoa sem a capacidade ligada é aviso", () => {
    const sem = TODOS.filter((p) => p !== "escalar");
    expect(regras(verificarPrompt({ prompt: `${LIMPO}\nChame uma pessoa da equipe.`, fonte: FONTE, pacotes: sem }))).toContain(
      "capacidade_sem_pacote",
    );
  });

  it("prompt curto é aviso de tamanho", () => {
    expect(regras(verificarPrompt({ prompt: "Quem você é:\nOi.", fonte: FONTE, pacotes: TODOS }))).toContain("tamanho");
  });

  it("erros vêm antes dos avisos", () => {
    const p = `# t\n${LIMPO}\n- Nunca fale de política.`;
    const niveis = verificarPrompt({ prompt: p, fonte: FONTE, pacotes: TODOS }).map((a) => a.nivel);
    expect(niveis.indexOf("aviso")).toBeGreaterThan(niveis.lastIndexOf("erro"));
  });
});

describe("pedidoDeCorrecao", () => {
  it("leva só os erros, numerados", () => {
    const achados = verificarPrompt({ prompt: `# t\n${LIMPO}\n- Nunca fale de política.`, fonte: FONTE, pacotes: TODOS });
    const pedido = pedidoDeCorrecao(achados);
    expect(pedido).toMatch(/1\. O prompt usa título com #/);
    expect(pedido).not.toMatch(/Proibição sem dizer/);
  });
});
