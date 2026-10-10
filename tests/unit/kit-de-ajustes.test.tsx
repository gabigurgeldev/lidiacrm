/**
 * Kit de Ajustes (`components/ajustes`): a linguagem Gestalt em componentes.
 *
 * O que se trava aqui é o contrato que as telas vão herdar:
 *  - o título do grupo fica FORA do cartão (dentro, virava a primeira linha);
 *  - linha que navega tem seta e `data-clicavel` (o hover do CSS depende dele);
 *  - o segmentado de escolha é um radiogroup que anda com as setas;
 *  - os formulários de bloco dos fluxos usam as MESMAS peças (reexport).
 *
 * Sabotagens medidas:
 *  - título dentro do `.ios-grupo` ⇒ "título fora" vermelho;
 *  - tirar o `onKeyDown` do segmentado ⇒ "setas" vermelho;
 *  - `shared.tsx` voltando a definir o próprio `Secao` ⇒ "mesma peça" vermelho.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...resto }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...resto}>
      {children}
    </a>
  ),
}));

import * as kit from "@/components/ajustes";
import { Grupo, Linha, LinhaInterruptor, PaginaAjustes, Segmentado } from "@/components/ajustes";
import * as formularios from "@/app/app/flows/[id]/_components/forms/shared";

afterEach(cleanup);

describe("kit de Ajustes", () => {
  it("página: título, descrição e ações no cabeçalho", () => {
    render(
      <PaginaAjustes titulo="Agentes" descricao="Quem atende seus clientes." acoes={<button>Novo</button>}>
        <p>corpo</p>
      </PaginaAjustes>,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Agentes");
    expect(screen.getByText("Quem atende seus clientes.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Novo" })).toBeInTheDocument();
  });

  it("grupo: título e rodapé ficam FORA do cartão", () => {
    render(
      <Grupo titulo="Atendimento" rodape="Vale para todos os números." testid="g">
        <Linha titulo="Horário" />
      </Grupo>,
    );
    const cartao = screen.getByTestId("g");
    expect(cartao).toHaveClass("ios-grupo");
    expect(cartao).not.toHaveTextContent("Atendimento");
    expect(cartao).not.toHaveTextContent("Vale para todos os números.");
    expect(cartao).toHaveTextContent("Horário");
  });

  it("linha que navega tem seta e data-clicavel; linha estática não", () => {
    render(
      <Grupo>
        <Linha titulo="Execuções" href="/app/ai/agents/1?aba=execucoes" valor="12" testid="nav" />
        <Linha titulo="Modelo" valor="Sonnet" testid="fixa" />
      </Grupo>,
    );
    const nav = screen.getByTestId("nav");
    expect(nav.tagName).toBe("A");
    expect(nav).toHaveAttribute("href", "/app/ai/agents/1?aba=execucoes");
    expect(nav).toHaveAttribute("data-clicavel", "sim");
    expect(nav.querySelector("svg")).not.toBeNull();
    const fixa = screen.getByTestId("fixa");
    expect(fixa).not.toHaveAttribute("data-clicavel");
    expect(fixa.querySelector("svg")).toBeNull();
  });

  it("linha com interruptor: o rótulo liga e desliga", () => {
    const aoMudar = vi.fn();
    render(<LinhaInterruptor titulo="Responder em áudio" ligado={false} aoMudar={aoMudar} />);
    fireEvent.click(screen.getByText("Responder em áudio"));
    expect(aoMudar).toHaveBeenCalledWith(true);
  });

  it("segmentado: radiogroup, um marcado, setas trocam a escolha", () => {
    const aoMudar = vi.fn();
    render(
      <Segmentado
        rotuloAcessivel="Papel do agente"
        valor="conversa"
        aoMudar={aoMudar}
        opcoes={[
          { valor: "conversa", rotulo: "Conversa" },
          { valor: "operador", rotulo: "Operador" },
          { valor: "ambos", rotulo: "Os dois" },
        ]}
      />,
    );
    expect(screen.getByRole("radiogroup", { name: "Papel do agente" })).toHaveClass("ios-segmentado");
    const conversa = screen.getByRole("radio", { name: "Conversa" });
    expect(conversa).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Operador" })).toHaveAttribute("aria-checked", "false");
    fireEvent.keyDown(conversa, { key: "ArrowRight" });
    expect(aoMudar).toHaveBeenLastCalledWith("operador");
    fireEvent.keyDown(conversa, { key: "ArrowLeft" });
    expect(aoMudar).toHaveBeenLastCalledWith("ambos");
  });

  it("os formulários de bloco dos fluxos usam as mesmas peças do kit", () => {
    expect(formularios.Secao).toBe(kit.Secao);
    expect(formularios.Campo).toBe(kit.Campo);
    expect(formularios.Dica).toBe(kit.Dica);
    expect(formularios.Aviso).toBe(kit.Aviso);
  });
});
