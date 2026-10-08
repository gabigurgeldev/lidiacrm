/**
 * QUANDO O SILÊNCIO DO TURNO É DEFEITO, E QUANDO É A REGRA FUNCIONANDO.
 *
 * `decidirResgateDoTurnoMudo` separa os dois. Errar para um lado deixa cliente
 * sem resposta sem ninguém saber; errar para o outro cobra o modelo a falar com
 * quem pediu para parar, ou enche a Central de avisos de coisa que tem dono.
 * O caminho do banco é medido em `tests/invariants/turno-mudo-cobra-e-avisa.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { decidirResgateDoTurnoMudo, MENSAGEM_DE_RESGATE } from "@/lib/agent-engine/agent/turno-mudo";

const MUDO = {
  kind: "inbound_turn",
  algoSaiu: false,
  clienteBloqueado: false,
  vetos: [] as string[],
  passouParaHumano: false,
};

describe("turno de resposta que terminou sem nada sair", () => {
  it("sem veto nenhum: cobra o modelo", () => {
    expect(decidirResgateDoTurnoMudo(MUDO).acao).toBe("cobrar_resposta");
    expect(decidirResgateDoTurnoMudo({ ...MUDO, kind: "case_reply_turn" }).acao).toBe("cobrar_resposta");
  });

  it("com veto que o modelo não contornou: avisa, sem cobrar (bateria na mesma conferência)", () => {
    expect(decidirResgateDoTurnoMudo({ ...MUDO, vetos: ["spinning", "promise_semantic"] }).acao).toBe("avisar");
  });
});

describe("silêncio que é a regra — nada acontece", () => {
  it("algo saiu", () => {
    expect(decidirResgateDoTurnoMudo({ ...MUDO, algoSaiu: true }).acao).toBe("nada");
  });

  it("cliente bloqueado (opt-out é irrevogável)", () => {
    expect(decidirResgateDoTurnoMudo({ ...MUDO, clienteBloqueado: true }).acao).toBe("nada");
  });

  it("a conversa foi passada para uma pessoa neste turno", () => {
    expect(decidirResgateDoTurnoMudo({ ...MUDO, passouParaHumano: true }).acao).toBe("nada");
  });

  it.each(["contato_bloqueado", "lgpd_anonymized", "lgpd_missing_legal_basis", "messaging_window_closed", "outside_window"])(
    "veto com dono próprio (%s)",
    (veto) => {
      expect(decidirResgateDoTurnoMudo({ ...MUDO, vetos: ["spinning", veto] }).acao).toBe("nada");
    },
  );

  it.each(["followup_turn", "operator_turn"])("turno que não é resposta ao cliente (%s)", (kind) => {
    expect(decidirResgateDoTurnoMudo({ ...MUDO, kind }).acao).toBe("nada");
  });
});

describe("a cobrança diz o que o modelo precisa saber", () => {
  it("nomeia as duas saídas e explica por que o texto não chegou", () => {
    expect(MENSAGEM_DE_RESGATE).toMatch(/send_message/);
    expect(MENSAGEM_DE_RESGATE).toMatch(/request_human_handoff/);
    expect(MENSAGEM_DE_RESGATE).toMatch(/NÃO chega/);
  });
});
