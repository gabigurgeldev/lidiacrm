/**
 * "Só responder sobre…" na tela: palavras por vírgula, regex só no avançado.
 *
 * O campo pedia uma expressão regular a quem nunca viu uma ("separe por barra
 * vertical"). Agora a pessoa escreve palavras; a tela grava o padrão escapado,
 * abre no avançado o que não é lista, e mostra o motivo quando o padrão seria
 * recusado ao salvar.
 *
 * Sabotagens medidas:
 *  - gravar o texto cru em vez de `palavrasParaPadrao` ⇒ primeiro caso vermelho;
 *  - tirar o parágrafo `filtro-de-assunto-erro` ⇒ terceiro caso vermelho.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (texto: string) => texto }));

import { TriggerEditor, type TriggerValue } from "@/app/app/ai/agents/[id]/_components/TriggerEditor";

afterEach(cleanup);

function valor(keyword_regex: string | null): TriggerValue {
  return {
    events: ["message"],
    filters: { ignore_groups: true, ignore_self: true, keyword_regex, business_hours: null },
    concurrency: "one_per_conversation",
  };
}

describe("filtro de assunto no editor do agente", () => {
  it("palavras por vírgula viram padrão escapado", () => {
    const onChange = vi.fn();
    render(<TriggerEditor value={valor(null)} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText("Ex.: pedido, entrega, segunda via"), {
      target: { value: "pedido, R$ 10" },
    });
    expect(onChange.mock.calls.at(-1)![0].filters.keyword_regex).toBe("pedido|R\\$ 10");
  });

  it("padrão salvo como lista abre como palavras; o que não é lista abre no avançado", () => {
    render(<TriggerEditor value={valor("pedido|entrega")} onChange={vi.fn()} />);
    expect(screen.getByDisplayValue("pedido, entrega")).toBeInTheDocument();
    cleanup();
    render(<TriggerEditor value={valor("\\bpedidos?\\b")} onChange={vi.fn()} />);
    expect(screen.getByDisplayValue("\\bpedidos?\\b")).toBeInTheDocument();
    expect(screen.getByText("Esta expressão não é uma lista de palavras")).toBeDisabled();
  });

  it("padrão que travaria o atendimento mostra o motivo", () => {
    render(<TriggerEditor value={valor("(a+)+$")} onChange={vi.fn()} />);
    expect(screen.getByTestId("filtro-de-assunto-erro")).toHaveTextContent(/repete um trecho que já se repete/);
  });

  it("membro de roteador vê que o filtro não vale", () => {
    render(<TriggerEditor value={valor(null)} onChange={vi.fn()} roteador={{ routerName: "Triagem" }} />);
    expect(screen.getByTestId("filtro-de-assunto-roteador")).toHaveTextContent(/Triagem/);
  });
});
