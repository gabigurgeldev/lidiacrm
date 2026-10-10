import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Message } from "@/lib/types/messaging";

import { OpcoesCard, SeloDeEscolha } from "./OpcoesCard";

function mensagem(over: Partial<Message>): Message {
  return {
    id: "m1",
    organization_id: "org",
    conversation_id: "conv",
    channel_session_id: "s",
    contact_id: "c",
    external_id: null,
    type: "poll",
    direction: "outbound",
    status: "sent",
    ack: null,
    error_code: null,
    error_message: null,
    body: "Qual setor?\n\n1️⃣ Suporte\n2️⃣ Financeiro",
    media_url: null,
    media_mime: null,
    media_size_bytes: null,
    media_storage_path: null,
    reply_to_message_id: null,
    sent_via: "user",
    sent_by_user_id: null,
    sent_at: "2026-10-10T12:00:00Z",
    delivered_at: null,
    read_at: null,
    metadata: {},
    edited_at: null,
    revoked_at: null,
    created_at: "2026-10-10T12:00:00Z",
    ...over,
  } as Message;
}

const OPCOES = {
  formato: "enquete",
  pergunta: "Qual setor?",
  opcoes: [
    { id: "o1", label: "Suporte" },
    { id: "o2", label: "Financeiro" },
  ],
};

describe("OpcoesCard", () => {
  it("mostra a pergunta e as opções — não o corpo numerado", () => {
    render(<OpcoesCard message={mensagem({ metadata: { opcoes: OPCOES } })} />);
    expect(screen.getByText("Qual setor?")).toBeTruthy();
    expect(screen.getByText("Suporte")).toBeTruthy();
    expect(screen.getByText("Financeiro")).toBeTruthy();
    expect(screen.queryByText(/1️⃣/u)).toBeNull();
    expect(screen.getByText("Esperando o cliente escolher")).toBeTruthy();
  });

  it("depois do toque, diz o que o cliente escolheu", () => {
    render(
      <OpcoesCard
        message={mensagem({ metadata: { opcoes: OPCOES, escolha: { opcao_id: "o2", opcao_label: "Financeiro" } } })}
      />,
    );
    expect(screen.getByText("O cliente escolheu: Financeiro")).toBeTruthy();
  });

  it("sem a metadata das opções, cai no corpo — nunca uma bolha vazia", () => {
    render(<OpcoesCard message={mensagem({ metadata: {} })} />);
    expect(screen.getByText(/Qual setor\?/u)).toBeTruthy();
  });
});

describe("SeloDeEscolha", () => {
  it("marca a resposta tocada", () => {
    render(
      <SeloDeEscolha
        message={mensagem({
          type: "text",
          direction: "inbound",
          body: "Financeiro",
          metadata: { resposta_interativa: { formato: "enquete", opcao_label: "Financeiro" } },
        })}
      />,
    );
    expect(screen.getByTestId("selo-de-escolha").textContent).toContain("Tocou na enquete");
  });

  it("mensagem digitada não ganha selo", () => {
    const { container } = render(
      <SeloDeEscolha message={mensagem({ type: "text", direction: "inbound", body: "oi", metadata: {} })} />,
    );
    expect(container.textContent).toBe("");
  });
});
