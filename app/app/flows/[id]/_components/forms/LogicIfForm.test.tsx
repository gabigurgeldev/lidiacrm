/**
 * O formulário do "Decidir" — o único bloco de forma variável.
 *
 * Cada saída é uma pergunta, e a primeira que for verdade vence. É o formulário
 * onde mais coisa pode quebrar em silêncio numa mudança de casa, por três
 * razões concretas:
 *
 *   1. o `id` de cada saída é o que a LIGAÇÃO no quadro guarda. Se acrescentar
 *      uma saída regenerasse ids, as linhas já desenhadas se soltariam;
 *   2. o valor comparado precisa virar NÚMERO quando é número — "score > 70"
 *      comparado como texto faz "9" ser maior que "10";
 *   3. o operador aparece em português na tela, mas viaja como identificador.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { LogicIfForm } from "./LogicIfForm";

interface Saida {
  id: string;
  label: string;
  quando: { combinador: string; itens: Array<{ campo: string; op: string; valor?: unknown }> };
}

const UMA_SAIDA: Saida[] = [
  {
    id: "s_existente",
    label: "Lead quente",
    quando: { combinador: "and", itens: [{ campo: "lead.score", op: "gt", valor: 70 }] },
  },
];

/**
 * O formulário é CONTROLADO: ele desenha a config que recebe e devolve a nova
 * por `aoMudarConfig`. Montá-lo com um espião seco e uma config fixa mediria
 * outra coisa — a config nunca voltaria, e cada tecla digitada reapareceria
 * somada ao valor velho ("70" + "9" = "709"). O harness fecha o ciclo, que é
 * como o canvas o usa de verdade.
 */
function montar(inicial: Record<string, unknown>) {
  const espiao = vi.fn();
  function Harness() {
    const [config, setConfig] = useState(inicial);
    return (
      <LogicIfForm
        config={config}
        aoMudarConfig={(nova) => {
          espiao(nova);
          setConfig(nova);
        }}
      />
    );
  }
  render(<Harness />);
  return { aoMudarConfig: espiao };
}

describe("o formulário do Decidir", () => {
  it("desenha uma caixa por saída, com o nome que a pessoa deu", () => {
    montar({ saidas: UMA_SAIDA });
    expect(screen.getByTestId("saida-s_existente")).toBeInTheDocument();
    expect(screen.getByTestId("rotulo-da-saida-s_existente")).toHaveValue("Lead quente");
  });

  it("⭐ acrescentar saída NÃO mexe no id das que já existem", async () => {
    // O id é o que a ligação no quadro guarda. Regenerá-lo soltaria as linhas
    // já desenhadas — e o quadro ficaria com setas apontando para o nada.
    const { aoMudarConfig } = montar({ saidas: UMA_SAIDA });
    await userEvent.click(screen.getByTestId("acrescentar-saida"));

    const novas = (aoMudarConfig.mock.calls.at(-1)?.[0] as { saidas: Saida[] }).saidas;
    expect(novas).toHaveLength(2);
    expect(novas[0]!.id, "o id da saída que já existia mudou").toBe("s_existente");
    expect(novas[1]!.id).not.toBe("s_existente");
  });

  it("⭐ valor numérico entra como NÚMERO, não como texto", async () => {
    // Comparado como texto, "9" > "10" é verdadeiro — e o funil manda o lead
    // errado para o vendedor certo, sem nada acusar.
    const { aoMudarConfig } = montar({ saidas: UMA_SAIDA });
    const campo = screen.getByTestId("valor-s_existente-0");
    await userEvent.clear(campo);
    await userEvent.type(campo, "9");

    const saidas = (aoMudarConfig.mock.calls.at(-1)?.[0] as { saidas: Saida[] }).saidas;
    expect(saidas[0]!.quando.itens[0]!.valor).toBe(9);
  });

  it("texto que não é número continua texto", async () => {
    const { aoMudarConfig } = montar({ saidas: UMA_SAIDA });
    const campo = screen.getByTestId("valor-s_existente-0");
    await userEvent.clear(campo);
    await userEvent.type(campo, "sim");

    const saidas = (aoMudarConfig.mock.calls.at(-1)?.[0] as { saidas: Saida[] }).saidas;
    expect(saidas[0]!.quando.itens[0]!.valor).toBe("sim");
  });

  it("o operador aparece em português, nunca o identificador cru", () => {
    montar({ saidas: UMA_SAIDA });
    const operador = screen.getByTestId("operador-s_existente-0");
    expect(operador.textContent).toContain("é maior que");
    expect(operador.textContent, "identificador cru do operador vazou").not.toContain("gt");
  });

  it("a última saída não pode ser removida", () => {
    montar({ saidas: UMA_SAIDA });
    expect(screen.queryByTestId("remover-saida-s_existente")).not.toBeInTheDocument();
  });

  it("com duas saídas, dá para remover uma", () => {
    montar({
      saidas: [
        ...UMA_SAIDA,
        {
          id: "s_outra",
          label: "Lead frio",
          quando: { combinador: "and", itens: [{ campo: "lead.score", op: "lt", valor: 20 }] },
        },
      ],
    });
    expect(screen.getByTestId("remover-saida-s_outra")).toBeInTheDocument();
  });
});
