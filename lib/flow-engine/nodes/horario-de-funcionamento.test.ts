/**
 * "Horário de funcionamento" SOBRE O MOTOR DE VERDADE.
 *
 * `tests/unit/janela-semanal.test.ts` mede o relógio puro. O que só aparece
 * aqui é a costura — e ela tem dois modos de falha que nenhum teste de função
 * pura alcança:
 *
 *   1. **A espera que reinicia.** O bloco devolve `wait`; algo acorda a execução
 *      antes da hora (outro evento, o backoff de uma falha vizinha); o bloco
 *      recalcula e dorme de novo. Se o alvo se mover a cada acordada, o fluxo
 *      nunca abre — e o sintoma é uma execução eternamente "waiting", sem uma
 *      linha de erro em lugar nenhum.
 *   2. **A saída que não vira aresta.** Escolher o ramo certo não prova nada se
 *      o motor não seguir por ele. Por isso a evidência aqui é sempre a TAG que
 *      o bloco seguinte grava, e nunca o `branch_id` lido por dentro.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { rodarTickDeFluxos } from "../engine";
import type { FlowGraph } from "../graph-schema";
import { esquecerRegistroParaTeste, garantirNosRegistrados } from "../register-all";
import { limparRegistroParaTeste } from "../registry";
import { criarMundoDeTeste, type MundoDeTeste } from "../teste/mundo";
import type { FlowExecutionContext } from "../types";

import { logicHorarioDeFuncionamento } from "./horario-de-funcionamento";

const pos = { x: 0, y: 0 };
const no = (id: string, type: string, config: unknown) => ({ id, type, label: id, position: pos, config });
const aresta = (id: string, source: string, target: string, branch_id = "else") => ({
  id,
  source,
  target,
  branch_id,
});

/** Domingo 20:00 em São Paulo — fechado para um expediente de seg a sex. */
const DOMINGO_A_NOITE = new Date("2026-09-13T23:00:00.000Z");
/** Terça 10:00 em São Paulo — aberto. */
const TERCA_DE_MANHA = new Date("2026-09-08T13:00:00.000Z");
/** Segunda 08:00 em São Paulo — a abertura seguinte a `DOMINGO_A_NOITE`. */
const SEGUNDA_NA_ABERTURA = new Date("2026-09-14T11:00:00.000Z");
/** Doze horas: de domingo 20:00 até segunda 08:00. */
const DOZE_HORAS_MS = 12 * 60 * 60 * 1000;

let mundo: MundoDeTeste;

beforeEach(() => {
  limparRegistroParaTeste();
  esquecerRegistroParaTeste();
  garantirNosRegistrados();
  mundo = criarMundoDeTeste();
});

/**
 * Expediente de seg a sex, 08:00–18:00, e uma tag em cada saída. A tag é a
 * evidência OBSERVÁVEL de por onde a execução passou.
 */
function grafo(config: Record<string, unknown>): FlowGraph {
  return {
    nodes: [
      no("inicio", "trigger.lead_created", {}),
      no("expediente", "logic.business_hours", {
        fuso: "America/Sao_Paulo",
        inicio: "08:00",
        fim: "18:00",
        dias: [1, 2, 3, 4, 5],
        fora_do_horario: "desviar",
        ...config,
      }),
      no("marca_dentro", "crm.add_tag", { tag: "dentro" }),
      no("marca_fora", "crm.add_tag", { tag: "fora-faltam-{{vars.abre_em_ms}}" }),
    ],
    edges: [
      aresta("e1", "inicio", "expediente"),
      aresta("e2", "expediente", "marca_dentro", "else"),
      aresta("e3", "expediente", "marca_fora", "fora"),
    ],
  };
}

describe("horário de funcionamento — qual saída", () => {
  it("⭐ dentro do expediente, segue pela saída de sempre", async () => {
    mundo.avancarPara(TERCA_DE_MANHA);
    await rodarTickDeFluxos(mundo.montar(grafo({})));

    expect(mundo.tags).toEqual(["dentro"]);
  });

  it("⭐ fora do expediente com 'desviar', segue pela outra saída AGORA", async () => {
    mundo.avancarPara(DOMINGO_A_NOITE);
    await rodarTickDeFluxos(mundo.montar(grafo({})));

    // Sai agora, e leva quanto falta para abrir — é com isto que o bloco
    // seguinte escreve "voltamos às 8h" em vez de um texto fixo que mente.
    expect(mundo.tags).toEqual([`fora-faltam-${DOZE_HORAS_MS}`]);
  });

  it("⭐ o dia da semana conta, e não só a hora", async () => {
    // Domingo 09:00 é hora comercial e NÃO é dia de expediente. Uma conta que
    // olhasse só o relógio deixaria este caso passar como aberto.
    mundo.avancarPara(new Date("2026-09-13T12:00:00.000Z"));
    await rodarTickDeFluxos(mundo.montar(grafo({})));

    expect(mundo.tags[0]?.startsWith("fora-faltam-")).toBe(true);
  });
});

describe("horário de funcionamento — segurar até abrir", () => {
  it("⭐ fora do expediente, ninguém é marcado: a execução dorme", async () => {
    mundo.avancarPara(DOMINGO_A_NOITE);
    await rodarTickDeFluxos(mundo.montar(grafo({ fora_do_horario: "esperar" })));

    expect(mundo.tags).toEqual([]);
    expect(mundo.execucoes.get("exec-1")?.status).toBe("waiting");
    expect(mundo.execucoes.get("exec-1")?.next_eval_at).toBe(SEGUNDA_NA_ABERTURA.toISOString());
  });

  it("⭐ na abertura, retoma pela saída de dentro", async () => {
    const g = grafo({ fora_do_horario: "esperar" });
    mundo.avancarPara(DOMINGO_A_NOITE);
    await rodarTickDeFluxos(mundo.montar(g));
    expect(mundo.tags).toEqual([]);

    mundo.avancarPara(SEGUNDA_NA_ABERTURA);
    await rodarTickDeFluxos(mundo.montar(g));

    expect(mundo.tags).toEqual(["dentro"]);
  });

  it("⭐ acordada cedo e ainda fechado, NÃO reinicia a contagem", async () => {
    const g = grafo({ fora_do_horario: "esperar" });
    mundo.avancarPara(DOMINGO_A_NOITE);
    await rodarTickDeFluxos(mundo.montar(g));
    const alvo = mundo.execucoes.get("exec-1")?.next_eval_at;

    // Alguém reclama a execução antes da hora — é o que um evento vizinho, ou o
    // backoff de outra frente, fazem no mundo real.
    mundo.avancarPara(new Date(DOMINGO_A_NOITE.getTime() + 60 * 60 * 1000));
    mundo.execucoes.set("exec-1", { ...mundo.execucoes.get("exec-1")!, status: "pending" });
    await rodarTickDeFluxos(mundo.montar(g));

    expect(mundo.tags).toEqual([]);
    // A MESMA hora. Recalcular daria o mesmo instante hoje, mas o dia em que
    // alguém trocar a conta por uma de contagem regressiva, este caso fica
    // vermelho antes de a espera virar eterna em produção.
    expect(mundo.execucoes.get("exec-1")?.next_eval_at).toBe(alvo);
  });
});

describe("horário de funcionamento — config que não dá para obedecer", () => {
  it("⭐ a execução MORRE com o motivo nomeado, e não segue torta", async () => {
    // O gate é o schema, não o `execute`: `analisarGrafo` valida a config de
    // cada nó contra o `configSchema` antes de o motor tocar no bloco, e a tela
    // de publicar roda a mesma análise. Um fuso com acento — o que um
    // hispanofalante escreve natural — não chega a rodar.
    mundo.avancarPara(DOMINGO_A_NOITE);
    await rodarTickDeFluxos(mundo.montar(grafo({ fuso: "America/Asunción" })));

    expect(mundo.tags).toEqual([]);
    const exec = mundo.execucoes.get("exec-1");
    expect(exec?.status).toBe("dead");
    expect(exec?.last_error).toContain("grafo_invalido");
  });

  it("⭐ sem nenhum dia escolhido, também não roda", async () => {
    mundo.avancarPara(DOMINGO_A_NOITE);
    await rodarTickDeFluxos(mundo.montar(grafo({ dias: [] })));

    expect(mundo.tags).toEqual([]);
    expect(mundo.execucoes.get("exec-1")?.status).toBe("dead");
  });
});

describe("horário de funcionamento — a rede embaixo do schema", () => {
  /**
   * Só dois campos do contexto são lidos por este bloco. O resto do
   * `FlowExecutionContext` são portas que ele nunca toca — montar um mundo
   * inteiro aqui esconderia justamente isso.
   */
  const ctxDe = (agora: Date, espera: { desde: Date; ate: Date } | null) =>
    ({ agora: () => agora, esperaEmCurso: espera }) as unknown as FlowExecutionContext;

  it("⭐ janela impossível faz o bloco seguir ABERTO, nunca travar", async () => {
    // Inalcançável pelo motor (o caso acima mostra por quê) e obrigatória pelo
    // tipo: `lerJanelaSemanal` devolve `JanelaSemanal | null`. O que este caso
    // fixa é a DIREÇÃO do `null` — uma config quebrada pode atrasar uma
    // resposta, nunca sumir com ela. O contrário é uma mordaça que ninguém
    // consegue diagnosticar, e é o defeito que o arquivo de origem em
    // `lib/agent-engine` já pagou uma vez.
    const config = {
      fuso: "America/Sao_Paulo",
      inicio: "18:00",
      fim: "08:00", // vira a meia-noite: recusada pelo relógio
      dias: [1, 2, 3, 4, 5],
      fora_do_horario: "esperar" as const,
    };
    const r = await logicHorarioDeFuncionamento.execute(ctxDe(DOMINGO_A_NOITE, null), config);

    expect(r).toEqual({ kind: "advance", branch_id: "else" });
  });
});
