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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { LogicIfForm } from "./LogicIfForm";

// O campo da regra passou a oferecer o seletor de variáveis, e ele lê os campos
// declarativos dos funis por react-query. Sem o provider o render morre com
// "No QueryClient set", que não é defeito deste formulário.
vi.mock("@/lib/api/client", () => ({ apiClient: { get: vi.fn(async () => ({ data: [] })) } }));

type ItemDaSaida =
  | { campo: string; op: string; valor?: unknown }
  | { combinador: string; negar?: boolean; itens: ItemDaSaida[] };

interface Saida {
  id: string;
  label: string;
  quando: { combinador: string; itens: ItemDaSaida[] };
}

/** O valor de uma regra simples. Grupo aninhado não tem valor — e o teste que
 *  pergunta por ele está medindo o item errado, então falhar é o certo. */
function valorDaRegra(item: ItemDaSaida | undefined): unknown {
  if (item === undefined || "itens" in item) throw new Error("esperava uma regra simples");
  return item.valor;
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
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  render(<Harness />, { wrapper: Wrapper });
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
    expect(valorDaRegra(saidas[0]!.quando.itens[0])).toBe(9);
  });

  it("texto que não é número continua texto", async () => {
    const { aoMudarConfig } = montar({ saidas: UMA_SAIDA });
    const campo = screen.getByTestId("valor-s_existente-0");
    await userEvent.clear(campo);
    await userEvent.type(campo, "sim");

    const saidas = (aoMudarConfig.mock.calls.at(-1)?.[0] as { saidas: Saida[] }).saidas;
    expect(valorDaRegra(saidas[0]!.quando.itens[0])).toBe("sim");
  });

  it("o operador aparece em português, nunca o identificador cru", () => {
    montar({ saidas: UMA_SAIDA });
    const operador = screen.getByTestId("operador-s_existente-0");
    expect(operador.textContent).toContain("é maior que");
    expect(operador.textContent, "identificador cru do operador vazou").not.toContain("gt");
  });

  it("⭐ marcador que PARECE número continua texto", async () => {
    // A versão anterior convertia todo valor numérico em qualquer operador. Um
    // marcador chamado `2024` virava o número 2024 e deixava de casar com a
    // string da coluna — a condição ficava falsa para sempre, sem erro.
    const { aoMudarConfig } = montar({
      saidas: [
        {
          id: "s_existente",
          label: "Marcado",
          quando: { combinador: "and", itens: [{ campo: "lead.tags", op: "contains" }] },
        },
      ],
    });
    const campo = screen.getByTestId("valor-s_existente-0");
    await userEvent.type(campo, "2024");

    const saidas = (aoMudarConfig.mock.calls.at(-1)?.[0] as { saidas: Saida[] }).saidas;
    expect(valorDaRegra(saidas[0]!.quando.itens[0])).toBe("2024");
  });

  it("⭐ dá para acrescentar e remover REGRA dentro da mesma saída", async () => {
    // Antes a saída nascia com uma regra e não havia botão nenhum: uma pergunta
    // de duas partes era impossível de escrever pela tela, embora o schema a
    // aceitasse desde sempre.
    const { aoMudarConfig } = montar({ saidas: UMA_SAIDA });
    await userEvent.click(screen.getByTestId("acrescentar-regra-s_existente"));

    const comDuas = (aoMudarConfig.mock.calls.at(-1)?.[0] as { saidas: Saida[] }).saidas;
    expect(comDuas[0]!.quando.itens).toHaveLength(2);

    await userEvent.click(screen.getByTestId("remover-regra-s_existente-1"));
    const comUma = (aoMudarConfig.mock.calls.at(-1)?.[0] as { saidas: Saida[] }).saidas;
    expect(comUma[0]!.quando.itens).toHaveLength(1);
  });

  it("⭐ o E/OU só aparece quando há mais de uma regra", async () => {
    montar({ saidas: UMA_SAIDA });
    expect(screen.queryByTestId("combinador-s_existente")).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("acrescentar-regra-s_existente"));
    expect(screen.getByTestId("combinador-s_existente")).toBeInTheDocument();
  });

  it("⭐ a pergunta de marcador grava os DOIS campos, lead e contato", async () => {
    // Perguntar só por `lead.tags` daria "não" para todo cliente que chegou pelo
    // WhatsApp — esse fluxo não tem lead nenhum.
    const { aoMudarConfig } = montar({
      saidas: [
        {
          id: "s_marcado",
          label: "É VIP",
          // A pergunta de marcador é UM item da saída — um grupo aninhado —, e
          // não a saída inteira: é isso que permite combiná-la com outra regra
          // por E/OU na mesma saída.
          quando: {
            combinador: "and",
            itens: [
              {
                combinador: "or",
                itens: [
                  { campo: "lead.tags", op: "contains", valor: "vip" },
                  { campo: "contact.tags", op: "contains", valor: "vip" },
                ],
              },
            ],
          },
        },
      ],
    });

    // A tela reconheceu a forma e desenhou a pergunta, não o editor cru.
    expect(screen.getByTestId("marcador-tag-s_marcado-0")).toHaveValue("vip");
    expect(screen.queryByTestId("campo-da-regra-s_marcado-0")).not.toBeInTheDocument();

    const campo = screen.getByTestId("marcador-tag-s_marcado-0");
    await userEvent.clear(campo);
    await userEvent.type(campo, "ouro");

    const saidas = (aoMudarConfig.mock.calls.at(-1)?.[0] as { saidas: Saida[] }).saidas;
    expect(saidas[0]!.quando.itens).toEqual([
      {
        combinador: "or",
        itens: [
          { campo: "lead.tags", op: "contains", valor: "ouro" },
          { campo: "contact.tags", op: "contains", valor: "ouro" },
        ],
      },
    ]);
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
