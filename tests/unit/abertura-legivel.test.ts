/**
 * A abertura do turno lida como conversa, com data e hora.
 *
 * O agente não sabia que dia era, e o histórico chegava como um blob JSON com
 * `"direction":"inbound"` e horário ISO em UTC. Aqui: o bloco "Agora" no fuso
 * do atendimento, a transcrição por papel, e a mídia que só aparece quando o
 * turno pode usá-la.
 *
 * Sabotagens medidas:
 *  - `blocoDoMomento` ignorando o fuso (sempre UTC) ⇒ "fuso" vermelho;
 *  - `ritualBlocks` voltando a `JSON.stringify(context)` ⇒ "transcrição" vermelho;
 *  - `mostrarMidia: true` com projeção ⇒ "mídia" vermelho.
 */
import { describe, expect, it } from "vitest";

import { blocoDoMomento, fusoUtilizavel, renderizarConversa } from "@/lib/agent-engine/agent/abertura-legivel";
import { buildOpeningMessage } from "@/lib/agent-engine/agent/inbound-turn";

const AGORA = new Date("2026-07-28T18:00:00Z"); // terça, 15h em São Paulo

describe("blocoDoMomento", () => {
  it("dá dia da semana, data e hora no fuso do atendimento", () => {
    const b = blocoDoMomento(AGORA, "America/Sao_Paulo");
    expect(b).toMatch(/^## Agora/);
    expect(b).toMatch(/terça-feira, 28 de julho de 2026, 15:00/);
    expect(blocoDoMomento(AGORA, "America/Manaus")).toMatch(/14:00/);
  });

  it("fuso inválido ou vazio cai no padrão, sem lançar", () => {
    expect(fusoUtilizavel("Lua/Base_Alfa")).toBe("America/Sao_Paulo");
    expect(fusoUtilizavel(null)).toBe("America/Sao_Paulo");
    expect(() => blocoDoMomento(AGORA, "Lua/Base_Alfa")).not.toThrow();
  });
});

describe("renderizarConversa", () => {
  const msgs = [
    { direction: "inbound" as const, body: "Oi, vocês abrem sábado?", sent_at: "2026-07-28T17:02:00Z" },
    {
      direction: "outbound" as const,
      body: "Abrimos sim, das 9h às 13h.",
      sent_at: "2026-07-28T17:03:00Z",
    },
    {
      direction: "inbound" as const,
      body: "[imagem]",
      sent_at: "2026-07-28T17:05:00Z",
      media_storage_path: "org/conv/foto.jpg",
    },
  ];

  it("escreve a conversa por papel, com horário local, da mais antiga para a mais recente", () => {
    const t = renderizarConversa(msgs, { fuso: "America/Sao_Paulo", mostrarMidia: false });
    expect(t.split("\n")).toEqual([
      "Cliente (ter 28/07 14:02): Oi, vocês abrem sábado?",
      "Nós (ter 28/07 14:03): Abrimos sim, das 9h às 13h.",
      "Cliente (ter 28/07 14:05): [imagem]",
    ]);
  });

  it("mídia: o caminho só aparece quando o turno pode usá-lo", () => {
    expect(renderizarConversa(msgs, { mostrarMidia: true })).toContain("[mídia: org/conv/foto.jpg]");
    expect(renderizarConversa(msgs, { mostrarMidia: false })).not.toContain("org/conv/foto.jpg");
  });

  it("sem mensagens, ou lista ausente, não quebra", () => {
    expect(renderizarConversa([], { mostrarMidia: false })).toBe("(nenhuma mensagem ainda)");
    expect(renderizarConversa(undefined, { mostrarMidia: false })).toBe("(nenhuma mensagem ainda)");
  });
});

describe("abertura do turno", () => {
  it("leva a transcrição, não o blob JSON das mensagens", () => {
    const contexto = {
      lead_id: "lead-1",
      contact: { name: "Ana", phone: null, email: null, tags: [], is_blocked: false },
      last_human_decision: null,
      messages: [{ direction: "inbound" as const, body: "Quero o plano anual", sent_at: "2026-07-28T17:02:00Z" }],
    };
    for (const projeta of [true, false]) {
      const abertura = buildOpeningMessage(null, null, contexto as never, "—", projeta, [], "America/Sao_Paulo");
      expect(abertura).toContain("## Conversa (da mais antiga para a mais recente)");
      expect(abertura).toContain("Cliente (ter 28/07 14:02): Quero o plano anual");
      // A fala aparece UMA vez: na transcrição, não também dentro do JSON.
      expect(abertura.split("Quero o plano anual").length - 1, `projeta=${projeta}`).toBe(1);
      expect(abertura).not.toContain('"direction"');
      expect(abertura).toContain('"Ana"');
    }
  });
});
