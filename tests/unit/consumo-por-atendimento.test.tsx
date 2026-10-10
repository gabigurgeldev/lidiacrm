/**
 * Ao lado dos limites por atendimento, o que o agente DE FATO gasta
 * (`lib/ai/agents/consumo-por-atendimento.ts` + `ConsumoPorAtendimento`).
 *
 * A conta tem de ser a do motor — tokens NOVOS, por turno (`job_id`) —, senão a
 * tela diz "nenhum seria cortado" para um limite que o motor corta. E o "teria
 * cortado" acompanha o que o dono digita, sem ida ao servidor.
 *
 * Sabotagens medidas: agrupar por chamada em vez de por turno; contar o cache
 * relido; o componente ignorar o limite do formulário.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (texto: string) => texto }));

import { ConsumoPorAtendimento } from "@/app/app/ai/agents/[id]/_components/ConsumoPorAtendimento";
import {
  agruparPorAtendimento,
  percentil,
  resumirConsumo,
  type LinhaDeChamada,
} from "@/lib/ai/agents/consumo-por-atendimento";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const linha = (job: string | null, input: number, cache: number, output: number, custo: string | null): LinhaDeChamada => ({
  job_id: job,
  input_tokens: input,
  cache_read_tokens: cache,
  output_tokens: output,
  cost_cents: custo,
});

describe("a conta do motor", () => {
  it("soma as chamadas do MESMO turno, e só os tokens novos", () => {
    const at = agruparPorAtendimento([
      linha("j1", 1000, 800, 50, "0.5"),
      linha("j1", 300, 0, 20, "0.25"),
      linha("j2", 100, 0, 10, "0.1"),
    ]);
    expect(at).toEqual([
      { tokens: 200 + 50 + 300 + 20, centavos: 0.75 },
      { tokens: 110, centavos: 0.1 },
    ]);
  });

  it("preço desconhecido numa chamada deixa o custo do turno desconhecido", () => {
    expect(agruparPorAtendimento([linha("j1", 10, 0, 1, "1"), linha("j1", 10, 0, 1, null)])).toEqual([
      { tokens: 22, centavos: null },
    ]);
  });

  it("percentil por posição, e lista vazia sem número inventado", () => {
    expect(percentil([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentil([5, 1, 3, 2, 4], 95)).toBe(5);
    expect(percentil([], 50)).toBeNull();
  });

  it("conta quantos o limite teria cortado — por tokens OU por custo", () => {
    const r = resumirConsumo(
      [
        { tokens: 500, centavos: 1 },
        { tokens: 1500, centavos: 1 },
        { tokens: 100, centavos: 60 },
      ],
      { tokens: 1000, centavos: 50 },
    );
    expect(r.atendimentos).toBe(3);
    expect(r.cortados).toBe(2);
  });
});

describe("o painel ao lado dos limites", () => {
  function servir(atendimentos: unknown[]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: { janela_em_dias: 30, atendimentos } }))),
    );
  }

  it("sem histórico, diz isso — não mostra zeros", async () => {
    servir([]);
    render(<ConsumoPorAtendimento agentId="a1" limites={{ tokens: 1000, centavos: 50 }} />);
    expect(await screen.findByTestId("consumo-sem-historico")).toBeInTheDocument();
  });

  it("o 'teria cortado' segue o limite que está no formulário", async () => {
    servir([
      { tokens: 500, centavos: 1 },
      { tokens: 1500, centavos: 1 },
    ]);
    const { rerender } = render(<ConsumoPorAtendimento agentId="a1" limites={{ tokens: 1000, centavos: 50 }} />);
    expect(await screen.findByTestId("consumo-cortados")).toHaveTextContent("1 deles teriam sido cortados");

    rerender(<ConsumoPorAtendimento agentId="a1" limites={{ tokens: 2000, centavos: 50 }} />);
    expect(screen.getByTestId("consumo-cortados")).toHaveTextContent("nenhum deles teria sido cortado");
  });
});
