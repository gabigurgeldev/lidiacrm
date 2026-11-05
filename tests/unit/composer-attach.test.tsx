import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const uploadResult = {
  storage_path: "org/conv/out-1.jpg",
  media_mime: "image/jpeg",
  media_size_bytes: 3,
  kind: "image" as const,
};
const uploadMock = vi.fn(async (args: { file: File }) => ({
  ...uploadResult,
  storage_path: `org/conv/out-${args.file.name}`,
}));
const sendMock = vi.fn(async (..._args: unknown[]) => ({ data: {} }));
const { toastWarning } = vi.hoisted(() => ({ toastWarning: vi.fn() }));

vi.mock("@/hooks/inbox/useUploadMedia", () => ({
  useUploadMedia: () => ({ mutateAsync: uploadMock, isPending: false }),
}));
vi.mock("@/hooks/inbox/useSendMessage", () => ({
  useSendMessage: () => ({ mutate: vi.fn(), mutateAsync: sendMock, isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { warning: toastWarning, success: vi.fn(), error: vi.fn() } }));
// O ritmo anti-ban é real em produção (1,2 s + jitter entre fotos); aqui zera
// para o teste não dormir. Quem prova o espaçamento é enviar-lote.test.ts.
vi.mock("@/lib/agent-engine/pacing/defaults", async (orig) => {
  const real = (await orig()) as { PACING_DEFAULTS: Record<string, unknown> };
  return { ...real, PACING_DEFAULTS: { ...real.PACING_DEFAULTS, throttleMs: 0, jitterMaxMs: 0 } };
});

import { Composer } from "@/components/inbox/Composer";

function renderComposer() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <Composer conversationId="conv-1" />
    </QueryClientProvider>,
  );
}

const foto = (nome: string) => new File([new Uint8Array([1, 2, 3])], nome, { type: "image/jpeg" });

function escolherFotos(files: File[]) {
  fireEvent.click(screen.getByRole("button", { name: /anexar/i }));
  const input = document.querySelector('input[accept^="image"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
}

describe("Composer + anexos", () => {
  beforeEach(() => {
    uploadMock.mockClear();
    sendMock.mockClear();
    toastWarning.mockClear();
  });

  it("botão Anexar abre o menu com as duas opções", () => {
    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: /anexar/i }));
    expect(screen.getByText("Fotos e vídeos")).toBeInTheDocument();
    expect(screen.getByText("Documento")).toBeInTheDocument();
  });

  it("o seletor de fotos aceita várias de uma vez; o de documento, uma", () => {
    renderComposer();
    expect(document.querySelector('input[accept^="image"]')).toHaveAttribute("multiple");
    expect(document.querySelector('input[accept^=".pdf"]')).not.toHaveAttribute("multiple");
  });

  it("selecionar arquivo abre preview e enviar dispara upload + send com caption", async () => {
    renderComposer();
    escolherFotos([foto("foto.jpg")]);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/legenda/i), { target: { value: "olha isso" } });
    fireEvent.click(screen.getByRole("button", { name: /^enviar$/i }));

    await waitFor(() => expect(uploadMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({
          conversation_id: "conv-1",
          type: "image",
          body: "olha isso",
          media_storage_path: "org/conv/out-foto.jpg",
          media_mime: "image/jpeg",
          media_size_bytes: 3,
        }),
      ),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("upload falho mantém o dialog aberto (sem disparar send)", async () => {
    uploadMock.mockRejectedValueOnce(new Error("upload_failed"));
    renderComposer();
    escolherFotos([foto("foto.jpg")]);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^enviar$/i }));

    await waitFor(() => expect(uploadMock).toHaveBeenCalled());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("três fotos viram três envios EM ORDEM, com a legenda só na primeira", async () => {
    renderComposer();
    escolherFotos([foto("a.jpg"), foto("b.jpg"), foto("c.jpg")]);

    expect(await screen.findByText("Enviar 3 anexos")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/legenda/i), { target: { value: "opções" } });
    fireEvent.click(screen.getByRole("button", { name: /^enviar$/i }));

    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(3));
    const enviados = sendMock.mock.calls.map((c) => c[0] as { media_storage_path: string; body?: string });
    expect(enviados.map((e) => e.media_storage_path)).toEqual([
      "org/conv/out-a.jpg",
      "org/conv/out-b.jpg",
      "org/conv/out-c.jpg",
    ]);
    expect(enviados.map((e) => e.body)).toEqual(["opções", undefined, undefined]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("falha na segunda foto para o lote e deixa no preview só as que não saíram", async () => {
    uploadMock
      .mockImplementationOnce(async (args: { file: File }) => ({ ...uploadResult, storage_path: args.file.name }))
      .mockRejectedValueOnce(new Error("upload_failed"));
    renderComposer();
    escolherFotos([foto("a.jpg"), foto("b.jpg"), foto("c.jpg")]);

    fireEvent.click(await screen.findByRole("button", { name: /^enviar$/i }));

    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(2));
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Enviar 2 anexos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remover b.jpg" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remover c.jpg" })).toBeInTheDocument();
  });

  it("remover uma foto do lote antes de enviar não a envia", async () => {
    renderComposer();
    escolherFotos([foto("a.jpg"), foto("b.jpg")]);

    fireEvent.click(await screen.findByRole("button", { name: "Remover a.jpg" }));
    expect(await screen.findByText("Enviar anexo")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^enviar$/i }));

    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1));
    expect(sendMock.mock.calls[0]![0]).toMatchObject({ media_storage_path: "org/conv/out-b.jpg" });
  });

  it("mais de 10 fotos: entram 10 e o excedente é avisado", async () => {
    renderComposer();
    escolherFotos(Array.from({ length: 12 }, (_, i) => foto(`f${i}.jpg`)));

    expect(await screen.findByText("Enviar 10 anexos")).toBeInTheDocument();
    expect(toastWarning).toHaveBeenCalledWith(expect.stringContaining("2 ficaram de fora"));
  });
});
