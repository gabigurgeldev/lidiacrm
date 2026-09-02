import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { AudioPlayer } from "@/components/inbox/media/AudioPlayer";

beforeAll(() => {
  // jsdom não implementa playback — mocka o mínimo do HTMLMediaElement.
  Object.defineProperty(window.HTMLMediaElement.prototype, "play", {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
  Object.defineProperty(window.HTMLMediaElement.prototype, "pause", {
    configurable: true,
    value: vi.fn(),
  });
});

describe("AudioPlayer", () => {
  it("renderiza com src do endpoint e controles", () => {
    render(<AudioPlayer messageId="m3" isOutbound={false} />);
    expect(screen.getByRole("button", { name: /reproduzir/i })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: /progresso/i })).toBeInTheDocument();
  });

  it("a velocidade NÃO existe antes do primeiro play", () => {
    // Mudança deliberada, e a asserção é pela AUSÊNCIA de propósito: antes do
    // play, "1x" não responde pergunta nenhuma — não há som tocando para estar
    // rápido ou lento. É o que o WhatsApp faz, e é o que tira um controle morto
    // de uma bolha que já é estreita.
    render(<AudioPlayer messageId="m3" isOutbound={false} />);
    expect(screen.queryByRole("button", { name: /velocidade/i })).toBeNull();
  });

  it("alterna play/pause", () => {
    render(<AudioPlayer messageId="m3" isOutbound={false} />);
    const btn = screen.getByRole("button", { name: /reproduzir/i });
    fireEvent.click(btn);
    expect(screen.getByRole("button", { name: /pausar/i })).toBeInTheDocument();
  });

  it("cicla a velocidade 1x → 1.5x → 2x → 1x, DEPOIS do play", () => {
    render(<AudioPlayer messageId="m3" isOutbound={false} />);
    // O play é o que faz o controle aparecer; sem ele não há o que ciclar.
    fireEvent.click(screen.getByRole("button", { name: /reproduzir/i }));
    const rate = screen.getByRole("button", { name: /velocidade/i });
    expect(rate).toHaveTextContent("1x");
    fireEvent.click(rate);
    expect(rate).toHaveTextContent("1.5x");
    fireEvent.click(rate);
    expect(rate).toHaveTextContent("2x");
    fireEvent.click(rate);
    expect(rate).toHaveTextContent("1x");
  });

  it("resiliente a duration Infinity (OGG stream): max=1 fallback, healing ao refinar", async () => {
    const { container } = render(<AudioPlayer messageId="m3" isOutbound={false} />);
    const input = screen.getByRole("slider");

    // Simula OGG report Infinity
    const audio = container.querySelector("audio") as HTMLAudioElement;
    Object.defineProperty(audio, "duration", {
      configurable: true,
      value: Infinity,
    });
    act(() => {
      audio.dispatchEvent(new Event("loadedmetadata"));
    });

    // max deve ser fallback "1"
    await waitFor(() => expect(input).toHaveAttribute("max", "1"));

    // Refina para 42
    Object.defineProperty(audio, "duration", { value: 42 });
    act(() => {
      audio.dispatchEvent(new Event("durationchange"));
    });

    // max heals para "42"
    await waitFor(() => expect(input).toHaveAttribute("max", "42"));
  });

  it("erro ao carregar exibe MediaUnavailable", async () => {
    const { container } = render(<AudioPlayer messageId="m3" isOutbound={false} />);
    const audio = container.querySelector("audio") as HTMLAudioElement;
    act(() => {
      audio.dispatchEvent(new Event("error"));
    });

    await waitFor(() => expect(screen.getByText(/mídia indisponível/i)).toBeInTheDocument());
  });
});
