/**
 * Compactar quando a conversa andou, não a cada mensagem.
 *
 * Com a janela do histórico ≥ o gatilho (agente com janela de 40+), TODO turno
 * pagava flush + compactação depois da 40ª mensagem. A marca-d'água vem da
 * última compactação registrada em `llm_calls` e das mensagens novas desde ela.
 *
 * Sabotagens medidas:
 *  - `deveCompactar` sem o ramo da marca (sempre true com janela cheia) ⇒
 *    "conversa andou pouco" vermelho;
 *  - sem a exigência de resumo durável ⇒ "sem resumo durável" vermelho.
 */
import { describe, expect, it, vi } from "vitest";

import {
  deveCompactar,
  lerMarcaDaCompactacao,
  passoDaCompactacao,
} from "@/lib/agent-engine/agent/marca-da-compactacao";

const base = { mensagensNaJanela: 40, gatilho: 40, temResumoDuravel: true };

describe("deveCompactar", () => {
  it("janela abaixo do gatilho: não compacta (como sempre foi)", () => {
    expect(deveCompactar({ ...base, mensagensNaJanela: 39, marca: { ultima: null, novasDesdeEla: 0 } })).toBe(false);
  });

  it("nunca compactou: compacta", () => {
    expect(deveCompactar({ ...base, marca: { ultima: null, novasDesdeEla: 0 } })).toBe(true);
  });

  it("conversa andou pouco desde a última: reaproveita", () => {
    expect(deveCompactar({ ...base, marca: { ultima: new Date(), novasDesdeEla: 3 } })).toBe(false);
  });

  it("entrou meio gatilho de mensagens novas: compacta de novo", () => {
    expect(passoDaCompactacao(40)).toBe(20);
    expect(deveCompactar({ ...base, marca: { ultima: new Date(), novasDesdeEla: 20 } })).toBe(true);
  });

  it("sem resumo durável para reaproveitar: compacta", () => {
    expect(
      deveCompactar({ ...base, temResumoDuravel: false, marca: { ultima: new Date(), novasDesdeEla: 1 } }),
    ).toBe(true);
  });

  it("gatilho minúsculo não zera o passo", () => {
    expect(passoDaCompactacao(1)).toBe(1);
  });
});

describe("lerMarcaDaCompactacao", () => {
  it("lê a última compactação ok do contato e conta as mensagens depois dela", async () => {
    const ultima = new Date("2026-07-28T10:00:00Z");
    const query = vi.fn(async () => ({ rows: [{ ultima, novas: "7" }] }));
    const m = await lerMarcaDaCompactacao({ query } as never, { tenantId: "org", leadId: "lead" });
    expect(m).toEqual({ ultima, novasDesdeEla: 7 });
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/purpose = 'compaction' and status = 'ok'/);
    expect(params).toEqual(["org", "lead"]);
  });
});
