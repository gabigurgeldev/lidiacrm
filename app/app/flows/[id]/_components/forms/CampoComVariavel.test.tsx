/**
 * O SELETOR DE VARIÁVEIS — o que ele escreve, e ONDE escreve.
 *
 * Três coisas que só quebram em runtime e nenhuma tela mostra:
 *
 *   1. **A posição.** Inserir no fim em vez de no cursor obriga a recortar e
 *      colar — que é exatamente o que o botão existe para evitar.
 *   2. **O modo.** `caminho` (o campo da regra do "Decidir") e `marcador` (todo
 *      o resto) escrevem coisas DIFERENTES, e trocar um pelo outro não dá erro:
 *      a condição devolve falso para sempre, ou a mensagem sai com a chave crua.
 *   3. **Os campos do funil.** Eles são o único pedaço do catálogo que vem do
 *      banco, e é onde mora o dado do nicho. Sem eles o seletor oferece o schema
 *      do produto e esconde o do cliente.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { CampoComVariavel, SeletorDeVariavel, type ModoDaVariavel } from "./CampoComVariavel";

const FUNIS = [
  {
    id: "f1",
    settings: { fields: [{ key: "numero_do_pedido", label: "Número do pedido", type: "text" }] },
  },
];

vi.mock("@/lib/api/client", () => ({
  apiClient: { get: vi.fn(async () => ({ data: FUNIS })) },
}));

function comQuery(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children: c }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{c}</QueryClientProvider>
  );
  return render(<>{children}</>, { wrapper: Wrapper });
}

describe("o seletor escreve a coisa certa", () => {
  it("⭐ modo marcador escreve entre chaves; modo caminho escreve cru", async () => {
    for (const [modo, esperado] of [
      ["marcador", "{{contact.name}}"],
      ["caminho", "contact.name"],
    ] as [ModoDaVariavel, string][]) {
      const aoEscolher = vi.fn();
      const tela = comQuery(<SeletorDeVariavel modo={modo} aoEscolher={aoEscolher} />);
      await userEvent.click(screen.getByTestId("abrir-variaveis"));
      await userEvent.click(await screen.findByTestId("variavel-contact.name"));

      expect(aoEscolher).toHaveBeenCalledWith(esperado);
      tela.unmount();
    }
  });

  it("⭐ os campos do funil entram na lista, com o rótulo que o cliente deu", async () => {
    const aoEscolher = vi.fn();
    comQuery(<SeletorDeVariavel modo="marcador" aoEscolher={aoEscolher} />);
    await userEvent.click(screen.getByTestId("abrir-variaveis"));

    const campo = await screen.findByTestId("variavel-lead.custom_fields.numero_do_pedido");
    expect(campo).toHaveTextContent("Número do pedido");
    await userEvent.click(campo);
    expect(aoEscolher).toHaveBeenCalledWith("{{lead.custom_fields.numero_do_pedido}}");
  });

  it("⭐ raiz aberta não inventa lista: pede o nome e monta o caminho", async () => {
    // `vars`, `event` e `global` guardam o que o FLUXO pôs lá. Uma lista fixa
    // aqui ofereceria nomes que não existem naquele fluxo — pior que não ter.
    const aoEscolher = vi.fn();
    comQuery(<SeletorDeVariavel modo="marcador" aoEscolher={aoEscolher} />);
    await userEvent.click(screen.getByTestId("abrir-variaveis"));
    await userEvent.click(await screen.findByTestId("abrir-livre-vars"));
    await userEvent.type(screen.getByTestId("digitar-vars"), "dono_escolhido");
    await userEvent.click(screen.getByRole("button", { name: "Usar" }));

    expect(aoEscolher).toHaveBeenCalledWith("{{vars.dono_escolhido}}");
  });
});

describe("o campo escreve na posição do cursor", () => {
  it("⭐ insere onde o cursor está, e não no fim", async () => {
    const aoMudar = vi.fn();
    comQuery(
      <CampoComVariavel valor="Oi , tudo bem?" aoMudar={aoMudar} testid="campo" multilinha />,
    );

    const campo = screen.getByTestId("campo") as HTMLTextAreaElement;
    campo.setSelectionRange(3, 3); // logo depois de "Oi "
    await userEvent.click(screen.getByTestId("abrir-variaveis"));
    await userEvent.click(await screen.findByTestId("variavel-contact.name"));

    expect(aoMudar).toHaveBeenCalledWith("Oi {{contact.name}}, tudo bem?");
  });

  it("substitui a seleção, em vez de empurrá-la para o lado", async () => {
    const aoMudar = vi.fn();
    comQuery(<CampoComVariavel valor="Oi FULANO!" aoMudar={aoMudar} testid="campo" />);

    const campo = screen.getByTestId("campo") as HTMLInputElement;
    campo.setSelectionRange(3, 9); // a palavra FULANO
    await userEvent.click(screen.getByTestId("abrir-variaveis"));
    await userEvent.click(await screen.findByTestId("variavel-contact.name"));

    expect(aoMudar).toHaveBeenCalledWith("Oi {{contact.name}}!");
  });
});
