/**
 * "NÃO" NÃO ESCALA A CONVERSA.
 *
 * ## O defeito, medido em produção
 *
 * Em 2026-09-23, nos eventos `ai.sentiment_alert` da instalação de produção, as
 * mensagens abaixo receberam nota do classificador e escalaram a conversa para
 * humano — o que manda ao cliente "sua conversa entrou na fila":
 *
 *   `Não` → 0.15 · `não` → 0.15 · `Vou não` → 0.15   (limiar: 0.3)
 *
 * Eram respostas a perguntas de sim/não. Os clientes do dono do produto
 * reclamaram de receber aviso de fila sem terem pedido atendimento.
 *
 * ## O que este arquivo mede, e o que ele NÃO mede
 *
 * Mede a guarda pura: quais mensagens sequer chegam ao classificador. NÃO mede
 * o que o modelo responde para as que chegam — isso depende de um provedor, e
 * a defesa correspondente é a REGRA 1 do prompt, que nenhum teste de unidade
 * pode afirmar sem chamar o modelo de verdade. Declarado, não escondido.
 *
 * As duas metades da guarda importam igualmente, e a segunda é a que costuma
 * ser esquecida: a lista NÃO PODE engolir reclamação curta. "péssimo",
 * "horrível", "cancela tudo" são mensagens de uma palavra que PRECISAM ser
 * classificadas — trocar um falso positivo barulhento por um falso negativo
 * mudo seria piorar, e num produto de atendimento o segundo não aparece em
 * métrica nenhuma.
 */
import { describe, expect, it } from "vitest";

import { ehRespostaSeca } from "@/lib/ai/sentiment/resposta-seca";

describe("resposta seca — as mensagens medidas em produção", () => {
  /**
   * Os três casos REAIS que escalaram conversa. Se algum deixar de ser pego,
   * o defeito voltou — e ele volta calado, porque quem recebe o aviso indevido
   * é o cliente final, não quem opera o sistema.
   */
  it.each(["Não", "não", "Vou não"])("pula a classificação de %j", (texto) => {
    expect(ehRespostaSeca(texto)).toBe(true);
  });

  it("pula com pontuação e emoji junto, que é como as pessoas escrevem", () => {
    // "Não." e "não 👍" são a MESMA resposta. Pegar uma grafia e perder a
    // vizinha é como uma lista destas morre sem ninguém notar.
    for (const t of ["Não.", "não!", "NÃO", "  não  ", "não 👍", "Ok!", "blz 😄"]) {
      expect(ehRespostaSeca(t), t).toBe(true);
    }
  });

  it("pula também as afirmativas — a simetria é deliberada", () => {
    // "sim" tampouco carrega humor. Tratar só o lado negativo deixaria a porta
    // aberta para alguém "consertar" metade do problema no futuro.
    for (const t of ["sim", "ok", "beleza", "certo", "isso mesmo", "combinado"]) {
      expect(ehRespostaSeca(t), t).toBe(true);
    }
  });
});

describe("a guarda NÃO pode silenciar reclamação", () => {
  /**
   * ⚠️ ESTE BLOCO É A RAZÃO DE A GUARDA SER UMA LISTA FECHADA E NÃO UMA REGRA
   * DE TAMANHO.
   *
   * Uma regra do tipo "menos de N palavras não classifica" pegaria os três
   * casos de cima e, junto, calaria a reclamação mais grave que existe — a de
   * uma palavra só. O teste abaixo é o que impede essa "simplificação".
   */
  it.each([
    "péssimo",
    "horrível",
    "lixo",
    "golpe",
    "cancela tudo",
    "quero meu dinheiro de volta",
    "não recebi meu pedido até hoje",
    "não gostei nada do atendimento",
    "não funciona, já tentei três vezes",
  ])("classifica %j normalmente", (texto) => {
    expect(ehRespostaSeca(texto)).toBe(false);
  });

  it("uma frase que CONTÉM 'não' não é resposta seca", () => {
    // A lição que o detector de opt-out já pagou: palavra isolada é sinal,
    // palavra dentro de frase não é. Lá, "tem como parar a dor?" bloqueava
    // paciente de clínica.
    expect(ehRespostaSeca("não consigo acessar minha conta")).toBe(false);
    expect(ehRespostaSeca("isso não é o que eu pedi")).toBe(false);
  });
});

describe("bordas", () => {
  it("vazio, nulo e só pontuação não são resposta seca", () => {
    // Quem cuida de corpo vazio é a guarda anterior do worker (`empty_body`).
    // Devolver `true` aqui faria duas peças reivindicarem a mesma decisão.
    for (const t of [null, undefined, "", "   ", "...", "??"]) {
      expect(ehRespostaSeca(t), String(t)).toBe(false);
    }
  });
});
