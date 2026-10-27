import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mutate = vi.fn();
let pendente = false;
vi.mock("@/hooks/pipelines/useStages", () => ({
  useCriarEtapa: () => ({ mutate, isPending: pendente }),
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));

import { NovaColuna } from "./NovaColuna";

describe("NovaColuna", () => {
  it("Enter manda o nome uma vez", () => {
    mutate.mockReset();
    pendente = false;
    render(<NovaColuna pipelineId="p-1" />);
    fireEvent.click(screen.getByTestId("nova-coluna"));
    const campo = screen.getByTestId("nome-da-nova-coluna");
    fireEvent.change(campo, { target: { value: "Proposta" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]![0]).toBe("Proposta");
  });

  it("enquanto o primeiro envio está em voo, Enter não manda de novo", () => {
    mutate.mockReset();
    pendente = true;
    render(<NovaColuna pipelineId="p-1" />);
    fireEvent.click(screen.getByTestId("nova-coluna"));
    const campo = screen.getByTestId("nome-da-nova-coluna");
    fireEvent.keyDown(campo, { key: "Enter" });
    fireEvent.click(screen.getByTestId("criar-coluna"));
    expect(mutate).not.toHaveBeenCalled();
  });
});
