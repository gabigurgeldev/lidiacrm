/**
 * O relatório do ensaio, lido para quem configura o agente
 * (`lib/ai/agents/leitura-do-ensaio.ts`).
 *
 * O que importa aqui é o dono do negócio não ler um código de motor no lugar de
 * uma razão: "barrada por pacing" não diz nada; "barrada por Segurar o ritmo de
 * envio" diz onde mexer. E o custo de um teste barato não pode aparecer como
 * zero — nem um custo sem preço conhecido aparecer como total.
 */
import { describe, expect, it } from "vitest";

import {
  aparar,
  conversaDepois,
  formatarCusto,
  lerConferencias,
  lerDesfecho,
  MAX_FALAS_DO_ENSAIO,
  type RelatorioDoEnsaio,
} from "@/lib/ai/agents/leitura-do-ensaio";

function relatorio(parcial: Partial<RelatorioDoEnsaio>): RelatorioDoEnsaio {
  return {
    id: "e1",
    desfecho: "respondeu",
    mensagens: [],
    ferramentas: [],
    conferencias: [],
    estado: { etapa: null, proximaAcao: null, resumo: null, notas: [] },
    avisos: [],
    adiamento: null,
    erro: null,
    custo: { chamadas: 0, centavos: 0, semPreco: 0, falhas: 0, tokensDeEntrada: 0, tokensDeSaida: 0 },
    esperasMs: [],
    duracaoMs: 0,
    ...parcial,
  };
}

describe("lerConferencias", () => {
  it("dá o nome da aba Confere antes de enviar a cada conferência, com o veredito", () => {
    const [tentativa] = lerConferencias([
      {
        trace: [
          { gate: "stop", verdict: "pass" },
          { gate: "pacing", verdict: "veto", code: "warmup_cap" },
          { gate: "messaging_window", verdict: "skipped", code: "not_applicable" },
        ],
        barradaPor: "pacing",
        codigo: "warmup_cap",
      },
    ]);
    expect(tentativa).toEqual({
      numero: 1,
      barradaPor: "Segurar o ritmo de envio",
      linhas: [
        { gate: "stop", rotulo: "Respeitar quem pediu para parar", resultado: "passou", codigo: null },
        { gate: "pacing", rotulo: "Segurar o ritmo de envio", resultado: "barrou", codigo: "warmup_cap" },
        {
          gate: "messaging_window",
          rotulo: "Respeitar a janela do WhatsApp",
          resultado: "nao_se_aplica",
          codigo: "not_applicable",
        },
      ],
    });
  });

  it("conferência nova, sem rótulo ainda, aparece pelo código — não some", () => {
    const [t] = lerConferencias([{ trace: [{ gate: "gate_novo", verdict: "pass" }], barradaPor: null, codigo: null }]);
    expect(t!.linhas[0]!.rotulo).toBe("gate_novo");
  });

  it("rastro ilegível vira lista vazia, nunca exceção na tela", () => {
    expect(lerConferencias([{ trace: "lixo", barradaPor: null, codigo: null }])[0]!.linhas).toEqual([]);
    expect(lerConferencias([{ trace: [null, 3, { verdict: "pass" }], barradaPor: null, codigo: null }])[0]!.linhas).toEqual(
      [],
    );
  });
});

describe("lerDesfecho", () => {
  it("cliente sem resposta por veto diz QUAL conferência barrou", () => {
    const d = lerDesfecho(
      relatorio({
        desfecho: "sem_resposta",
        conferencias: [
          { trace: [], barradaPor: "internal_vocabulary", codigo: "x" },
          { trace: [], barradaPor: "internal_vocabulary", codigo: "x" },
        ],
      }),
    );
    expect(d.tom).toBe("erro");
    expect(d.detalhe).toBe("Toda mensagem que o agente tentou foi barrada: Não falar a nossa língua com o seu cliente.");
  });

  it("cliente sem resposta sem veto diz que o agente não chamou o envio", () => {
    expect(lerDesfecho(relatorio({ desfecho: "sem_resposta" })).detalhe).toMatch(/sem chamar o envio/);
  });

  it("fora do assunto diz que ESTE agente não responderia, e para onde a mensagem iria", () => {
    const d = lerDesfecho(relatorio({ desfecho: "fora_do_assunto" }));
    expect(d.titulo).toBe("Este agente não responderia");
    expect(d.detalhe).toMatch(/Só responder sobre/);
    expect(d.tom).toBe("atencao");
  });

  it("adiado traz o motivo do motor; falha traz o erro", () => {
    expect(
      lerDesfecho(relatorio({ desfecho: "adiado", adiamento: { motivo: "fora da janela", ate: null } })).detalhe,
    ).toBe("fora da janela");
    expect(lerDesfecho(relatorio({ desfecho: "falhou", erro: "sem chave" })).detalhe).toBe("sem chave");
  });

  it("respondeu conta as mensagens e lembra que nada saiu", () => {
    const d = lerDesfecho(relatorio({ mensagens: [{ texto: "a", template: false }, { texto: "b", template: false }] }));
    expect(d).toEqual({ titulo: "O agente respondeu", detalhe: "2 mensagens — nada foi enviado ao WhatsApp.", tom: "ok" });
  });
});

describe("formatarCusto", () => {
  const custo = (centavos: number, semPreco = 0) => ({
    chamadas: 1,
    centavos,
    semPreco,
    falhas: 0,
    tokensDeEntrada: 0,
    tokensDeSaida: 0,
  });

  it("teste barato não aparece como zero", () => {
    expect(formatarCusto(custo(0.05))).toBe("US$ 0,0005");
  });

  it("valores normais em duas casas", () => {
    expect(formatarCusto(custo(12.5))).toBe("US$ 0,13");
  });

  it("modelo sem preço conhecido avisa que o valor é piso", () => {
    expect(formatarCusto(custo(0, 2))).toBe("US$ 0,00 (ou mais)");
  });
});

describe("a conversa continua", () => {
  it("as respostas do agente entram como falas, depois das do cliente", () => {
    const r = relatorio({ mensagens: [{ texto: "Oi!", template: false }, { texto: "Como ajudo?", template: false }] });
    expect(conversaDepois([{ de: "cliente", texto: "olá" }], r)).toEqual([
      { de: "cliente", texto: "olá" },
      { de: "agente", texto: "Oi!" },
      { de: "agente", texto: "Como ajudo?" },
    ]);
  });

  it("a conversa longa perde as falas mais antigas, nunca a última", () => {
    const longa = Array.from({ length: MAX_FALAS_DO_ENSAIO + 5 }, (_, i) => ({ de: "cliente" as const, texto: `m${i}` }));
    const aparada = aparar(longa);
    expect(aparada).toHaveLength(MAX_FALAS_DO_ENSAIO);
    expect(aparada.at(-1)!.texto).toBe(`m${MAX_FALAS_DO_ENSAIO + 4}`);
  });
});
