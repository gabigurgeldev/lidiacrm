/**
 * A tela de execuções DE UM FLUXO — quem disparou, e o passo a passo.
 *
 * Duas regras moram fora dos componentes de propósito, e são estas que os
 * testes prendem:
 *
 *  1. QUEM disparou. `flow_executions.contact_id` é nulo quando o gatilho
 *     nasceu de lead (o `trigger-matcher` só o preenche quando o payload do
 *     evento o traz). Sem o desempate pelo lead, a tela diria "sem contato"
 *     para metade das execuções — e a pergunta que ela existe para responder é
 *     exatamente essa.
 *  2. QUANTO TEMPO entre um passo e outro. É o número que tornou a lentidão
 *     visível sem abrir o banco: 59,1s numa retomada contra 0,1-0,9s entre nós.
 */
import { describe, expect, it } from "vitest";

import {
  contatoDaExecucao,
  nomeDoContato,
  type ExecucaoDeFluxo,
} from "@/hooks/flows/useFlowExecutions";
import {
  segundosDesdeOPassoAnterior,
  type PassoDaExecucao,
} from "@/hooks/flows/useFlowExecutionTrail";

const CONTATO = {
  id: "c1",
  display_name: "Carla",
  name: "Carla Oliveira",
  phone_number: "+5594981627533",
};

const base: ExecucaoDeFluxo = {
  id: "e1",
  flow_id: "f1",
  version_id: "v1",
  status: "completed",
  current_node_id: "n1",
  outcome: "concluido",
  last_error: null,
  attempts: 0,
  steps_taken: 3,
  lead_id: null,
  contact_id: null,
  started_at: "2026-09-04T14:28:00.000Z",
  completed_at: null,
  next_eval_at: null,
  contato: null,
  lead: null,
};

describe("quem disparou o fluxo", () => {
  it("⭐ usa o contato da execução quando ele existe", () => {
    expect(contatoDaExecucao({ ...base, contato: CONTATO })?.id).toBe("c1");
  });

  it("⭐ cai no contato DO LEAD quando `contact_id` é nulo — gatilho de lead", () => {
    // Sem este desempate a tela diria "sem contato" em toda execução nascida
    // de lead, que é metade delas.
    const e = { ...base, lead: { id: "l1", title: "Lead", contato: CONTATO } };
    expect(contatoDaExecucao(e)?.id).toBe("c1");
  });

  it("devolve null quando não há contato em lugar nenhum", () => {
    expect(contatoDaExecucao(base)).toBeNull();
  });
});

describe("o nome que a tela mostra", () => {
  it("⭐ prefere o apelido, depois o nome, e o telefone como último recurso", () => {
    expect(nomeDoContato(CONTATO)).toBe("Carla");
    expect(nomeDoContato({ ...CONTATO, display_name: null })).toBe("Carla Oliveira");
    expect(nomeDoContato({ ...CONTATO, display_name: null, name: null })).toBe(
      "+5594981627533",
    );
  });

  it("null vira null — quem decide a frase de vazio é a tela", () => {
    expect(nomeDoContato(null)).toBeNull();
  });
});

const passo = (id: string, iso: string): PassoDaExecucao => ({
  id,
  node_id: "n1",
  event_type: "no_avancou",
  payload: null,
  created_at: iso,
});

describe("o intervalo entre passos", () => {
  it("⭐ mede o salto que denunciou a lentidão (59,1s)", () => {
    const passos = [
      passo("1", "2026-09-04T14:28:01.731Z"),
      passo("2", "2026-09-04T14:29:00.866Z"),
    ];
    expect(segundosDesdeOPassoAnterior(passos, 1)).toBeCloseTo(59.1, 1);
  });

  it("⭐ o primeiro passo não tem anterior", () => {
    expect(segundosDesdeOPassoAnterior([passo("1", "2026-09-04T14:28:00.000Z")], 0)).toBeNull();
  });

  it("mede décimos — é a ordem de grandeza de um nó rodando", () => {
    const passos = [
      passo("1", "2026-09-04T14:28:00.780Z"),
      passo("2", "2026-09-04T14:28:01.670Z"),
    ];
    expect(segundosDesdeOPassoAnterior(passos, 1)).toBeCloseTo(0.9, 1);
  });

  it("nunca devolve negativo, mesmo com relógio fora de ordem", () => {
    const passos = [
      passo("1", "2026-09-04T14:29:00.000Z"),
      passo("2", "2026-09-04T14:28:00.000Z"),
    ];
    expect(segundosDesdeOPassoAnterior(passos, 1)).toBe(0);
  });
});
