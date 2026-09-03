/**
 * TODO BLOCO REGISTRADO NO MOTOR TEM FORMULÁRIO NA TELA.
 *
 * ## O defeito que este arquivo fecha
 *
 * O painel de ajustes degrada em silêncio de propósito: bloco sem formulário
 * mostra "Este bloco não tem ajustes" em vez de quebrar a tela. É a postura
 * certa em produção e a errada no build — porque o texto é indistinguível
 * entre os dois casos que o produzem:
 *
 *   1. o bloco REALMENTE não tem o que ajustar (`logic.merge`, por exemplo);
 *   2. alguém registrou um bloco novo no motor e esqueceu do formulário.
 *
 * No segundo caso o bloco aparece na paleta, entra no quadro, publica — e não
 * há como configurá-lo. O sintoma ("esse bloco não tem ajustes") lê como
 * decisão de projeto, então ninguém abre chamado.
 *
 * Este teste separa os dois: o caso 1 é declarado aqui, por escrito, com o
 * motivo; qualquer outro tipo sem formulário reprova.
 *
 * É o mesmo desenho de `tests/unit/navegacao-completude.test.ts` (tela sem
 * porta na navegação) — allowlist que só encolhe, nunca uma exceção muda.
 */
import { describe, expect, it } from "vitest";

import { garantirNosRegistrados } from "@/lib/flow-engine/register-all";
import { tiposRegistrados } from "@/lib/flow-engine/registry";

import { FORMULARIO_DO_TIPO } from "./nodeFormRegistry";

/**
 * Blocos que legitimamente não têm o que ajustar.
 *
 * ⚠️ Cada entrada precisa de motivo escrito, e a lista só encolhe. Acrescentar
 * um tipo aqui para "fazer o teste passar" é exatamente o defeito acima com uma
 * assinatura embaixo.
 *
 * (Hoje vazia: `trigger.lead_created` e `logic.merge` não têm campo nenhum, mas
 * TÊM formulário — um que explica o que o bloco faz. Explicar é ajuste também:
 * o painel em branco é o que fazia a pessoa achar que faltava algo.)
 */
const SEM_FORMULARIO_POR_ORA: ReadonlyArray<{ tipo: string; porque: string }> = [];

describe("todo bloco registrado tem formulário", () => {
  it("a varredura enxerga os dois lados (senão ela mede o vazio)", () => {
    garantirNosRegistrados();
    // Controle positivo: um registry vazio ou um mapa vazio fariam a asserção
    // principal passar por vacuidade.
    expect(tiposRegistrados().length).toBeGreaterThan(10);
    expect(Object.keys(FORMULARIO_DO_TIPO).length).toBeGreaterThan(10);
  });

  it("⭐ nenhum tipo do motor fica sem formulário na tela", () => {
    garantirNosRegistrados();
    const dispensados = new Set(SEM_FORMULARIO_POR_ORA.map((d) => d.tipo));

    const orfaos = tiposRegistrados().filter(
      (tipo) => FORMULARIO_DO_TIPO[tipo] === undefined && !dispensados.has(tipo),
    );

    expect(
      orfaos,
      `bloco(s) registrados no motor sem formulário em nodeFormRegistry.ts: ${orfaos.join(", ")}. ` +
        "Quem monta o fluxo vê 'este bloco não tem ajustes' e não tem como configurá-lo. " +
        "Escreva o formulário em forms/, ou declare o tipo em SEM_FORMULARIO_POR_ORA com o motivo.",
    ).toEqual([]);
  });

  it("o mapa não tem formulário para tipo que o motor não conhece", () => {
    // A direção contrária: formulário órfão é código morto que ninguém alcança,
    // e costuma ser resto de um tipo renomeado — o rastro de uma renomeação
    // pela metade, que é como o mapa começa a mentir.
    garantirNosRegistrados();
    const conhecidos = new Set(tiposRegistrados());
    const sobrando = Object.keys(FORMULARIO_DO_TIPO).filter((tipo) => !conhecidos.has(tipo));

    expect(
      sobrando,
      `formulário(s) para tipo que o motor não registra: ${sobrando.join(", ")}. ` +
        "Ou o tipo foi renomeado e o mapa ficou para trás, ou o formulário é código morto.",
    ).toEqual([]);
  });

  it("cada entrada dispensada traz motivo escrito", () => {
    for (const { tipo, porque } of SEM_FORMULARIO_POR_ORA) {
      expect(porque.trim().length, `${tipo} está dispensado sem motivo`).toBeGreaterThan(20);
    }
  });
});
