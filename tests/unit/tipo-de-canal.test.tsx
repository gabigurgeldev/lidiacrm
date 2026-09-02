/**
 * QR CODE OU OFICIAL — a distinção que existia no banco e não chegava à tela.
 *
 * ## Por que isto é mais que enfeite
 *
 * Os dois tipos parecem o mesmo número no seletor e têm regras de envio
 * OPOSTAS: no canal oficial da Meta existe a janela de 24h — fora dela só sai
 * modelo aprovado, o resto a plataforma recusa — e no número por QR não existe
 * janela nenhuma. Quem escolhe o número pelo seletor estava escolhendo por qual
 * regra ia responder, sem que a tela dissesse qual.
 *
 * ## A asserção que carrega o arquivo
 *
 * `desconhecido` não desenha NADA. Um clone antigo, cujo banco não tem a coluna
 * `provider`, recebe a lista sem ela de propósito (`consultaTolerante`), e um
 * selo chutado ali afirmaria a regra ERRADA sobre quando se pode escrever. Selo
 * errado sobre isso é pior que selo nenhum — e é o tipo de "melhoria visual"
 * que vira suporte.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { TipoDeCanal } from "@/components/channels/TipoDeCanal";
import {
  CHANNEL_PROVIDER_META,
  CHANNEL_PROVIDER_WAHA,
  CHANNEL_PROVIDER_ZERNIO,
} from "@/lib/channels/capabilities";
import { conexaoNaTela, tipoDaConexao } from "@/lib/channels/tipo-de-conexao";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (texto: string) => texto }));

afterEach(cleanup);

describe("a regra", () => {
  it("traduz os dois providers que a tela sabe explicar", () => {
    expect(tipoDaConexao(CHANNEL_PROVIDER_WAHA)).toBe("qr");
    expect(tipoDaConexao(CHANNEL_PROVIDER_META)).toBe("oficial");
  });

  it("o que ela não sabe explicar vira `desconhecido`, não um chute", () => {
    // Coluna ausente no clone antigo e provider novo que este código não conhece.
    expect(tipoDaConexao(null)).toBe("desconhecido");
    expect(tipoDaConexao(undefined)).toBe("desconhecido");
    expect(tipoDaConexao("um_provider_do_futuro")).toBe("desconhecido");
  });

  it("separa a REGRA DE ENVIO de QUEM intermedeia — são duas perguntas", () => {
    // O canal direto não tem intermediário, e o `parceiro` fica nulo em vez de
    // virar string vazia: a tela testa presença, não conteúdo.
    expect(conexaoNaTela(CHANNEL_PROVIDER_WAHA)).toEqual({
      transporte: "qr",
      viaParceiro: false,
      parceiro: null,
    });
  });

  it("o intermediado é OFICIAL por baixo — e antes ele não tinha selo nenhum", () => {
    // Regressão de comportamento deliberada: `tipoDaConexao` devolvia
    // `desconhecido` aqui, e a consequência era o operador não ver a janela de
    // 24h num canal que a tem. É um BSP: a WABA é da Meta, o template é aprovado
    // pela Meta, e a janela é da Meta. Só o TRANSPORTE é de terceiro.
    const c = conexaoNaTela(CHANNEL_PROVIDER_ZERNIO);
    expect(c.transporte).toBe("oficial");
    expect(c.viaParceiro).toBe(true);
    // A marca chega como DADO à tela, que não pode nomear provider.
    expect(c.parceiro).toBeTruthy();
  });

  it("provider desconhecido não vira parceiro por engano", () => {
    expect(conexaoNaTela("um_provider_do_futuro").viaParceiro).toBe(false);
  });
});

describe("o selo", () => {
  it("diz QR code no número pareado pelo aparelho", () => {
    render(<TipoDeCanal provider={CHANNEL_PROVIDER_WAHA} />);
    const selo = screen.getByTestId("tipo-de-canal");
    expect(selo).toHaveTextContent("QR code");
    expect(selo).toHaveAttribute("data-tipo", "qr");
  });

  it("diz Oficial no canal da Meta, e explica a janela no title", () => {
    render(<TipoDeCanal provider={CHANNEL_PROVIDER_META} />);
    const selo = screen.getByTestId("tipo-de-canal");
    expect(selo).toHaveTextContent("Oficial");
    // A explicação é onde mora a consequência prática, e ela precisa estar
    // alcançável: é o que separa um rótulo bonito de uma informação útil.
    expect(selo.getAttribute("title")).toMatch(/24h/);
  });

  it("NÃO desenha nada quando não dá para afirmar", () => {
    // A asserção que justifica o arquivo. Sem ela, a implementação mais óbvia —
    // cair em "QR code" no `else` — passaria nos dois casos acima e mentiria
    // sobre a regra de envio em todo clone que ainda não tem a coluna.
    const { container } = render(<TipoDeCanal provider={null} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("tipo-de-canal")).toBeNull();
  });

  it("marca o intermediado no DOM, para a lista poder distinguir sem reler a regra", () => {
    render(<TipoDeCanal provider={CHANNEL_PROVIDER_ZERNIO} />);
    const selo = screen.getByTestId("tipo-de-canal");
    expect(selo).toHaveAttribute("data-tipo", "oficial");
    expect(selo).toHaveAttribute("data-via-parceiro", "sim");
    expect(selo).toHaveTextContent("Oficial");
  });

  it("nomeia o parceiro no cartão, onde há espaço — e não no selo estreito", () => {
    // Na lista e no seletor o selo divide a linha com o nome do número; a marca
    // ali empurraria o telefone para fora. No cartão de Conexões ela cabe, e é
    // justamente onde o operador decide a quem pedir suporte.
    const { rerender } = render(<TipoDeCanal provider={CHANNEL_PROVIDER_ZERNIO} variante="selo" />);
    expect(screen.getByTestId("tipo-de-canal").textContent).not.toMatch(/·/);

    rerender(<TipoDeCanal provider={CHANNEL_PROVIDER_ZERNIO} variante="cartao" />);
    expect(screen.getByTestId("tipo-de-canal").textContent).toMatch(/·/);
  });

  it("na bolha não imprime rótulo, mas continua legível por leitor de tela", () => {
    // O rótulo se repetiria em cada mensagem da thread e empurraria a hora para
    // fora da linha. Sumir da tela não pode significar sumir da acessibilidade.
    render(<TipoDeCanal provider={CHANNEL_PROVIDER_META} variante="bolha" />);
    const selo = screen.getByTestId("tipo-de-canal");
    expect(selo.querySelector(".sr-only")?.textContent).toMatch(/24h/);
    expect(selo.textContent).not.toMatch(/^Oficial/);
  });
});
