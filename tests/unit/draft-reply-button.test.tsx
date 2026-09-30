/**
 * "Sugerir resposta" (rascunho da IA) mora no menu de opções do campo de
 * escrever — abre o "+" e escolhe. O item fica ocupado enquanto a IA pensa e
 * não fecha o menu antes do rascunho chegar.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";

const postMock = vi.fn();
vi.mock("@/lib/api/client", () => ({
  apiClient: { post: (...args: unknown[]) => postMock(...args) },
}));

const showApiErrorMock = vi.fn();
vi.mock("@/components/feedback/ApiErrorToast", () => ({
  showApiError: (...args: unknown[]) => showApiErrorMock(...args),
}));

import { MenuDeOpcoes } from "@/components/inbox/composer/MenuDeOpcoes";

function montar(onRascunho = vi.fn(), extra: Partial<React.ComponentProps<typeof MenuDeOpcoes>> = {}) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MenuDeOpcoes
        conversationId="conv-1"
        modo="reply"
        respostaBarrada={false}
        desabilitado={false}
        onArquivo={vi.fn()}
        onContato={vi.fn()}
        onMensagensProntas={vi.fn()}
        onRascunho={onRascunho}
        onAlternarNota={vi.fn()}
        {...extra}
      />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Anexar" }));
  return onRascunho;
}

beforeEach(() => {
  postMock.mockReset();
  showApiErrorMock.mockReset();
});

describe("Sugerir resposta no menu de opções", () => {
  it("clicar dispara a IA, marca o item ocupado e entrega o rascunho", async () => {
    let resolvePost!: (v: unknown) => void;
    postMock.mockReturnValue(new Promise((resolve) => (resolvePost = resolve)));
    const onRascunho = montar();

    const item = screen.getByRole("menuitem", { name: "Sugerir resposta" });
    fireEvent.click(item);

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/api/v1/conversations/conv-1/draft-reply", {}),
    );
    await waitFor(() => expect(item).toHaveAttribute("aria-busy", "true"));

    resolvePost({ data: { draft: "texto sugerido" } });
    await waitFor(() => expect(onRascunho).toHaveBeenCalledWith("texto sugerido"));
  });

  it("erro chama showApiError e não entrega rascunho", async () => {
    postMock.mockRejectedValue(new Error("falhou"));
    const onRascunho = montar();
    fireEvent.click(screen.getByRole("menuitem", { name: "Sugerir resposta" }));
    await waitFor(() => expect(showApiErrorMock).toHaveBeenCalled());
    expect(onRascunho).not.toHaveBeenCalled();
  });

  it("com a resposta barrada (janela fechada), anexos e IA saem do menu — a nota fica", () => {
    montar(vi.fn(), { respostaBarrada: true });
    expect(screen.queryByRole("menuitem", { name: "Sugerir resposta" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Fotos e vídeos" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Nota interna" })).toBeTruthy();
  });
});
