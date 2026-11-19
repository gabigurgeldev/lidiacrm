/**
 * O lado da TELA do "vídeo pelo inbox dá erro e sai em dobro" — ver o
 * cabeçalho de `envio-de-video-pelo-inbox.test.ts` para o relato inteiro.
 *
 * Aqui: o envio de mídia espera o servidor (não os 10 s padrão), a desistência
 * sem resposta NÃO manda "tentar de novo", e o arquivo acima do teto é barrado
 * na escolha, antes de a tela subir o arquivo inteiro para ouvir "não".
 */
import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { postMock, toastWarning, toastError, uploadMock } = vi.hoisted(() => ({
  postMock: vi.fn(),
  toastWarning: vi.fn(),
  toastError: vi.fn(),
  uploadMock: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({ apiClient: { post: postMock } }));
vi.mock("sonner", () => ({
  toast: { warning: toastWarning, error: toastError, success: vi.fn(), info: vi.fn() },
}));
vi.mock("@/hooks/inbox/useUploadMedia", () => ({
  useUploadMedia: () => ({ mutateAsync: uploadMock, isPending: false }),
}));

import { Composer } from "@/components/inbox/Composer";
import { useSendMessage } from "@/hooks/inbox/useSendMessage";
import { PRAZO_DA_TELA_PARA_ENVIO_DE_MIDIA_MS } from "@/lib/inbox/prazo-do-envio";
import { MAX_MEDIA_BYTES } from "@/lib/messaging/media/types";

function comQuery() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

const video = {
  conversation_id: "conv-1",
  type: "video",
  media_storage_path: "org/conv-1/out-1.wa.mp4",
  media_mime: "video/mp4",
  media_size_bytes: 1234,
};

describe("useSendMessage — mídia espera o servidor", () => {
  beforeEach(() => {
    postMock.mockReset();
    toastWarning.mockReset();
    toastError.mockReset();
  });

  it("envio de vídeo sai com o prazo longo, uma tentativa só", async () => {
    postMock.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useSendMessage(), { wrapper: comQuery() });
    await result.current.mutateAsync(video);
    expect(postMock).toHaveBeenCalledWith("/api/v1/messages", video, {
      semRepetir: true,
      timeoutMs: PRAZO_DA_TELA_PARA_ENVIO_DE_MIDIA_MS,
    });
  });

  it("texto segue no prazo padrão do apiClient", async () => {
    postMock.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useSendMessage(), { wrapper: comQuery() });
    await result.current.mutateAsync({ conversation_id: "conv-1", body: "oi" });
    expect(postMock.mock.calls[0]![2]).toEqual({ semRepetir: true, timeoutMs: undefined });
  });

  it("a tela desistiu sem resposta: avisa para conferir a conversa, e NÃO diz 'tente novamente'", async () => {
    postMock.mockRejectedValue(new DOMException("signal is aborted without reason", "AbortError"));
    const { result } = renderHook(() => useSendMessage(), { wrapper: comQuery() });
    await expect(result.current.mutateAsync(video)).rejects.toThrow();

    expect(toastWarning).toHaveBeenCalledTimes(1);
    const frase = String(toastWarning.mock.calls[0]![0]);
    expect(frase).toMatch(/Confira na conversa se a mensagem saiu/);
    expect(frase).not.toMatch(/tente novamente/i);
    // O genérico ("Erro inesperado. Tente novamente.") não pode sair junto.
    expect(toastError).not.toHaveBeenCalled();
  });
});

describe("Composer — arquivo acima do teto é barrado na escolha", () => {
  beforeEach(() => {
    uploadMock.mockReset();
    toastWarning.mockReset();
  });

  function arquivoDe(nome: string, type: string, size: number): File {
    const f = new File([new Uint8Array([1])], nome, { type });
    Object.defineProperty(f, "size", { value: size });
    return f;
  }

  function escolher(files: File[]) {
    fireEvent.click(screen.getByRole("button", { name: /anexar/i }));
    const input = document.querySelector('input[accept^="image"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files } });
  }

  it("vídeo longo (acima de 50 MB): aviso com o tamanho, sem janela e sem upload", () => {
    render(<Composer conversationId="conv-1" />, { wrapper: comQuery() });
    escolher([arquivoDe("aula-14min.mp4", "video/mp4", 312 * 1024 * 1024)]);

    expect(toastWarning).toHaveBeenCalledTimes(1);
    const frase = String(toastWarning.mock.calls[0]![0]);
    expect(frase).toContain("aula-14min.mp4");
    expect(frase).toContain("312 MB");
    expect(frase).toContain("50 MB");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("no lote, só o grande fica de fora; o que cabe vai para a janela", async () => {
    render(<Composer conversationId="conv-1" />, { wrapper: comQuery() });
    escolher([
      arquivoDe("curto.mp4", "video/mp4", 5 * 1024 * 1024),
      arquivoDe("longo.mp4", "video/mp4", MAX_MEDIA_BYTES + 1),
    ]);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(toastWarning).toHaveBeenCalledTimes(1);
    expect(String(toastWarning.mock.calls[0]![0])).toContain("longo.mp4");
  });
});
