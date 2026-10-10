/**
 * "Só responder sobre…" — a regra que escolhe o agente pelo assunto.
 *
 * O campo existia na tela e o motor nunca o lia (só o dispatcher legado, que é
 * NO-OP). Aqui: o assunto é a rajada inteira, sem acento; o filtro falha aberto;
 * a conversa em andamento não é cortada no meio; e, com dois agentes no número,
 * o primeiro por prioridade que aceita o assunto é quem atende.
 *
 * Sabotagens medidas:
 *  - `montarAssunto` usando só o último corpo ⇒ "rajada inteira" vermelho;
 *  - tirar `semAcento(filtro)` de `passaNoFiltro` ⇒ "acento no filtro" vermelho;
 *  - `passaNoFiltro` devolvendo `false` quando `compilarSeguro` é null ⇒ "falha aberta" vermelho;
 *  - tirar o ramo `emAndamentoCom` de `escolherPorAssunto` ⇒ "em andamento" vermelho.
 */
import { describe, expect, it } from "vitest";

import {
  escolherPorAssunto,
  lerFiltroDeAssunto,
  montarAssunto,
  passaNoFiltro,
} from "@/lib/agent-engine/agent/filtro-de-assunto";
import { LIMITE_DO_ASSUNTO } from "@/lib/regex/segura";

describe("montarAssunto", () => {
  it("junta a rajada inteira, em ordem", () => {
    expect(montarAssunto(["oi", "queria saber", "do meu pedido"])).toBe("oi\nqueria saber\ndo meu pedido");
  });

  it("tira acento e põe em minúsculas", () => {
    expect(montarAssunto(["Qual o PREÇO da Instalação?"])).toBe("qual o preco da instalacao?");
  });

  it("sem texto (só áudio, só foto) é null", () => {
    expect(montarAssunto([null, "  ", null])).toBeNull();
    expect(montarAssunto([])).toBeNull();
  });

  it("corta no limite do assunto", () => {
    expect(montarAssunto(["a".repeat(LIMITE_DO_ASSUNTO + 500)])!.length).toBe(LIMITE_DO_ASSUNTO);
  });
});

describe("lerFiltroDeAssunto", () => {
  it("lê trigger_config.filters.keyword_regex", () => {
    expect(lerFiltroDeAssunto({ filters: { keyword_regex: "pedido|entrega" } })).toBe("pedido|entrega");
  });
  it("vazio, ausente ou de outro tipo é sem filtro", () => {
    expect(lerFiltroDeAssunto({ filters: { keyword_regex: "  " } })).toBeNull();
    expect(lerFiltroDeAssunto({ filters: {} })).toBeNull();
    expect(lerFiltroDeAssunto({ filters: { keyword_regex: 42 } })).toBeNull();
    expect(lerFiltroDeAssunto(null)).toBeNull();
    expect(lerFiltroDeAssunto("lixo")).toBeNull();
  });
});

describe("passaNoFiltro", () => {
  it("casa por palavra, sem diferenciar maiúscula", () => {
    expect(passaNoFiltro("pedido|entrega", "cade minha ENTREGA".toLowerCase())).toBe(true);
    expect(passaNoFiltro("pedido|entrega", "bom dia")).toBe(false);
  });

  it("acento no filtro casa com o assunto sem acento", () => {
    expect(passaNoFiltro("orçamento|preço", montarAssunto(["Quanto é o orcamento?"]))).toBe(true);
    expect(passaNoFiltro("orçamento|preço", montarAssunto(["qual o PREÇO"]))).toBe(true);
  });

  it("sem filtro ou sem assunto passa", () => {
    expect(passaNoFiltro(null, "qualquer coisa")).toBe(true);
    expect(passaNoFiltro("pedido", null)).toBe(true);
  });

  it("falha aberta: padrão salvo antes da validação (inválido ou perigoso) vale como sem filtro", () => {
    expect(passaNoFiltro("pedido(", "bom dia")).toBe(true);
    expect(passaNoFiltro("(a+)+$", "bom dia")).toBe(true);
    expect(passaNoFiltro("x".repeat(500), "bom dia")).toBe(true);
  });
});

describe("escolherPorAssunto", () => {
  const vendas = { agentId: "vendas", filtroDeAssunto: "preco|orcamento|comprar" };
  const suporte = { agentId: "suporte", filtroDeAssunto: "pedido|entrega|troca" };
  const geral = { agentId: "geral", filtroDeAssunto: null };

  it("o primeiro por prioridade que aceita o assunto atende", () => {
    const e = escolherPorAssunto([vendas, suporte], { assunto: "cade meu pedido", emAndamentoCom: null });
    expect(e).toEqual({ escolhido: suporte, motivo: "filtro" });
  });

  it("agente sem filtro aceita tudo — e só perde para quem vem antes", () => {
    expect(escolherPorAssunto([vendas, geral], { assunto: "bom dia", emAndamentoCom: null })).toEqual({
      escolhido: geral,
      motivo: "sem_filtro",
    });
    expect(escolherPorAssunto([geral, vendas], { assunto: "qual o preco", emAndamentoCom: null }).escolhido).toBe(geral);
  });

  it("ninguém aceita: fora do assunto, ninguém responde", () => {
    expect(escolherPorAssunto([vendas, suporte], { assunto: "bom dia", emAndamentoCom: null })).toEqual({
      escolhido: null,
      motivo: "fora_do_assunto",
    });
  });

  it("conversa em andamento segue com quem já atende, mesmo fora do assunto", () => {
    const e = escolherPorAssunto([vendas, suporte], { assunto: "pode ser terca?", emAndamentoCom: "suporte" });
    expect(e).toEqual({ escolhido: suporte, motivo: "em_andamento" });
  });

  it("agente em andamento que não está mais no número não conta", () => {
    const e = escolherPorAssunto([vendas], { assunto: "bom dia", emAndamentoCom: "despublicado" });
    expect(e.motivo).toBe("fora_do_assunto");
  });

  it("número sem agente publicado", () => {
    expect(escolherPorAssunto([], { assunto: "oi", emAndamentoCom: null }).motivo).toBe("sem_candidato");
  });
});
