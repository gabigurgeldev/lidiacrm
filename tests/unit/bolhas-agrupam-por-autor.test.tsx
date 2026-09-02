/**
 * O AGRUPAMENTO DAS BOLHAS — o que separa uma conversa de uma lista.
 *
 * Dez mensagens seguidas da mesma pessoa desenhavam dez retângulos idênticos,
 * cada um com seu rabo e seu respiro cheio: dez interrupções em vez de um
 * parágrafo. É a diferença mais visível entre o inbox e o WhatsApp Web, e ela
 * não está na cor nem no raio — está aqui.
 *
 * ## O que este arquivo mede, e o que ele não alcança
 *
 * Mede o SINAL (`data-ponta`) que a folha de estilo consome para desenhar o
 * rabo, e as regras que decidem quando o bloco quebra. Não mede o rabo
 * desenhado: ele é um `::after` com `clip-path`, e o jsdom não aplica CSS. Um
 * caso daqui afirmando "o rabo apareceu" seria falha-em-verde; quem prova o
 * pixel é a bancada de CSS num chromium de verdade.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { MessageBubble } from "@/components/inbox/MessageBubble";
import type { Message } from "@/lib/types/messaging";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (texto: string) => texto }));
vi.mock("@/hooks/i18n/useLocaleDeData", () => ({ useLocaleDeData: () => undefined }));

function msg(over: Partial<Message> = {}): Message {
  return {
    id: "m1",
    conversation_id: "c1",
    direction: "inbound",
    type: "text",
    body: "oi",
    status: "delivered",
    sent_at: "2026-08-30T12:00:00Z",
    ...over,
  } as Message;
}

afterEach(cleanup);

/** A bolha é o elemento que carrega o lado — o invólucro externo não carrega. */
const bolha = (container: HTMLElement) => container.querySelector("[data-lado]");

describe("a ponta da bolha", () => {
  it("a PRIMEIRA de um bloco a recebe", () => {
    const { container } = render(<MessageBubble message={msg()} primeiraDoBloco />);
    expect(bolha(container)).toHaveAttribute("data-ponta", "true");
  });

  it("as seguintes NÃO recebem — é isso que cola o bloco", () => {
    const { container } = render(<MessageBubble message={msg()} primeiraDoBloco={false} />);
    expect(bolha(container)).toHaveAttribute("data-ponta", "false");
  });

  it("uma bolha sozinha é sempre a primeira do próprio bloco", () => {
    // O default importa: uma prévia, um teste, um render isolado — nenhum deles
    // deve nascer sem rabo, porque não há bloco anterior a que se colar.
    const { container } = render(<MessageBubble message={msg()} />);
    expect(bolha(container)).toHaveAttribute("data-ponta", "true");
  });

  it("figurinha sem legenda não ganha ponta — ela não tem bolha", () => {
    // Sem moldura, o rabo ficaria flutuando ao lado da imagem.
    const { container } = render(
      <MessageBubble
        message={msg({ type: "sticker", body: null, media_url: "https://x.invalid/s.webp" })}
        primeiraDoBloco
      />,
    );
    expect(bolha(container)).toHaveAttribute("data-ponta", "false");
  });
});

describe("o lado", () => {
  it("o que entra e o que sai são declarados, não inferidos da classe", () => {
    // `data-lado` existe porque o rabo é um pseudo-elemento e precisa saber de
    // que lado desenhar. Ler isso de uma classe de cor amarraria a geometria à
    // paleta — e a paleta é trocada em runtime pelo revendedor.
    const { container: entrada } = render(<MessageBubble message={msg()} />);
    expect(bolha(entrada)).toHaveAttribute("data-lado", "entrada");
    cleanup();
    const { container: saida } = render(
      <MessageBubble message={msg({ direction: "outbound" })} />,
    );
    expect(bolha(saida)).toHaveAttribute("data-lado", "saida");
  });
});

describe("a hora dentro da bolha", () => {
  it("texto puro reserva a faixa para a hora", () => {
    const { container } = render(<MessageBubble message={msg({ body: "Que bom" })} />);
    expect(container.querySelector(".bolha-texto")).not.toBeNull();
    expect(container.querySelector(".bolha-meta-flutuante")).not.toBeNull();
  });

  it("com MÍDIA a hora volta para o fluxo", () => {
    // A asserção que impede o efeito colateral bonito: flutuando, o metadado
    // cairia sobre a imagem (sem sombra própria, ilegível) ou sobre o botão do
    // player de áudio.
    const { container } = render(
      <MessageBubble
        message={msg({ type: "image", body: "olha", media_url: "https://x.invalid/f.jpg" })}
      />,
    );
    expect(container.querySelector(".bolha-meta-flutuante")).toBeNull();
  });

  it("mensagem APAGADA não reserva faixa nenhuma", () => {
    // Ela é o CRM narrando o que houve com aquele lugar da conversa, não fala de
    // ninguém — reservar espaço ali daria a ela um enquadramento que não pede.
    const { container } = render(
      <MessageBubble message={msg({ revoked_at: "2026-08-30T12:05:00Z" })} />,
    );
    expect(container.querySelector(".bolha-texto")).toBeNull();
    expect(screen.getByText("Esta mensagem foi apagada")).toBeInTheDocument();
  });
});
