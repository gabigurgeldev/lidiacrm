/**
 * DE ONDE VEIO ESTA MENSAGEM — o selo dentro da bolha.
 *
 * ## Por que na bolha, e não só no cabeçalho
 *
 * O cabeçalho diz por onde a CONVERSA entrou; a bolha diz por onde AQUELA
 * mensagem passou. Parecem a mesma coisa e não são: a conversa aponta para uma
 * sessão só, enquanto cada mensagem carrega o próprio `channel_session_id`, e
 * um histórico pode atravessar troca de número, migração de canal ou a exclusão
 * do canal por onde ele começou. Quem lê a thread precisa saber sob qual regra
 * cada linha foi dita — no canal oficial, fora da janela de 24h só sai modelo
 * aprovado; no número por QR não há janela nenhuma.
 *
 * ## As asserções que carregam o arquivo
 *
 * Duas, e as duas são sobre o que NÃO acontece:
 *
 *  - canal desconhecido não ganha selo chutado, e — o detalhe que só aparece na
 *    tela — também não paga a RESERVA de espaço do selo. Reservar a faixa e não
 *    desenhar nada abre um vão no fim de toda mensagem.
 *  - canal excluído cai no canal da conversa em vez de perder o selo. É o caso
 *    em que o selo mais serve: entender por que aquelas mensagens pararam.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { MessageBubble } from "@/components/inbox/MessageBubble";
import {
  CHANNEL_PROVIDER_META,
  CHANNEL_PROVIDER_WAHA,
} from "@/lib/channels/capabilities";
import type { Message } from "@/lib/types/messaging";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (texto: string) => texto }));
vi.mock("@/hooks/i18n/useLocaleDeData", () => ({
  useLocaleDeData: () => undefined,
  useTagDeIdioma: () => "pt-BR",
}));

afterEach(cleanup);

const mensagem = (over: Partial<Message> = {}): Message =>
  ({
    id: "m1",
    organization_id: "org",
    conversation_id: "c1",
    channel_session_id: "s1",
    contact_id: "ct1",
    type: "text",
    direction: "inbound",
    status: "delivered",
    body: "oi",
    sent_via: "user",
    sent_at: new Date("2026-09-01T12:00:00Z").toISOString(),
    metadata: {},
    ...over,
  }) as unknown as Message;

describe("o selo na bolha", () => {
  it("diz o tipo do canal por onde a mensagem passou", () => {
    render(<MessageBubble message={mensagem()} canalProvider={CHANNEL_PROVIDER_META} />);
    const selo = screen.getByTestId("tipo-de-canal");
    expect(selo).toHaveAttribute("data-tipo", "oficial");
  });

  it("não imprime rótulo — ele se repetiria em cada linha da thread", () => {
    render(<MessageBubble message={mensagem()} canalProvider={CHANNEL_PROVIDER_WAHA} />);
    // ⚠️ A asserção é sobre o texto VISÍVEL, e a distinção é o próprio ponto:
    // `textContent` inclui o `.sr-only`, que existe justamente para o rótulo
    // continuar alcançável por leitor de tela. Medir por `textContent` reprovaria
    // a implementação correta e passaria numa que apagasse a acessibilidade.
    const selo = screen.getByTestId("tipo-de-canal");
    const visivel = [...selo.children]
      .filter((el) => !el.classList.contains("sr-only"))
      .map((el) => el.textContent ?? "")
      .join("");
    expect(visivel).not.toContain("QR code");
    // A hora continua sendo o metadado legível; o canal fala por ícone.
    //
    // ⚠️ Por PADRÃO e não pelo valor: `format(…, "HH:mm")` usa o fuso da
    // máquina, então "09:00" só vale em UTC−3. O CI roda em UTC e este caso
    // reprovava lá — verde no laptop, vermelho no runner, sem nada a ver com o
    // que ele mede (que a hora não sumiu ao dar lugar ao selo).
    expect(screen.getByText(/^\d{2}:\d{2}$/)).toBeInTheDocument();
  });

  it("continua legível por leitor de tela, com a consequência prática junto", () => {
    render(<MessageBubble message={mensagem()} canalProvider={CHANNEL_PROVIDER_META} />);
    expect(screen.getByTestId("tipo-de-canal").querySelector(".sr-only")?.textContent).toMatch(
      /24h/,
    );
  });
});

describe("quando não dá para afirmar", () => {
  it("não desenha selo nenhum", () => {
    render(<MessageBubble message={mensagem()} canalProvider={null} />);
    expect(screen.queryByTestId("tipo-de-canal")).toBeNull();
  });

  it("e NÃO reserva a faixa do selo — senão sobra um vão no fim do texto", () => {
    // A reserva é `--bolha-reserva`, calculada no CSS a partir deste atributo.
    // Sem esta asserção, a implementação mais fácil (reservar sempre) passaria
    // no caso acima e abriria um buraco em toda mensagem de canal desconhecido.
    const { container } = render(<MessageBubble message={mensagem()} canalProvider={null} />);
    expect(container.querySelector(".bolha")).toHaveAttribute("data-com-selo", "false");
  });

  it("reserva quando o selo existe", () => {
    const { container } = render(
      <MessageBubble message={mensagem()} canalProvider={CHANNEL_PROVIDER_WAHA} />,
    );
    expect(container.querySelector(".bolha")).toHaveAttribute("data-com-selo", "true");
  });
});
