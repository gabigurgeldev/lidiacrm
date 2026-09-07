/**
 * O BOTÃO DE REMOVER EXISTE PARA TODO BLOCO — INCLUSIVE O DE INÍCIO.
 *
 * ## O defeito que este arquivo pina
 *
 * O painel recebia `podeApagar` e o `FlowCanvas` a calculava como
 * `categoria !== "trigger"`: no bloco de início o botão não era desabilitado,
 * era REMOVIDO DO DOM, sem tooltip e sem uma linha dizendo por quê. A pessoa
 * concluía que aquele bloco não sai — e não saía mesmo.
 *
 * Hoje a prop não existe: o painel sempre mostra o botão, e quem decide se a
 * remoção pede confirmação é o `FlowCanvas`, que é quem conhece o grafo.
 *
 * ## O que este arquivo NÃO prova
 *
 * O outro lado do relato — "não consigo apagar ALGUNS blocos" — era de LAYOUT:
 * o botão tinha `mt-auto` dentro do container que rola e caía abaixo da dobra
 * em tipos de formulário longo. Isso não se mede em jsdom, onde tudo tem altura
 * zero. A prova é a spec Playwright `fluxo-apaga-renomeia-exclui.spec.ts`, que
 * compara `boundingBox()` do botão com o do painel.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PainelDoNo } from "./PainelDoNo";

function montar(tipo: string) {
  const aoApagar = vi.fn();
  render(
    <PainelDoNo
      tipo={tipo}
      rotulo="Bloco"
      config={{}}
      aoMudarRotulo={vi.fn()}
      aoMudarConfig={vi.fn()}
      aoApagar={aoApagar}
    />,
  );
  return { aoApagar };
}

describe("PainelDoNo", () => {
  it("mostra o botão de remover no bloco de início", () => {
    montar("trigger.lead_created");
    expect(screen.getByTestId("apagar-no")).toBeTruthy();
  });

  it("mostra o botão de remover num bloco comum", () => {
    montar("logic.wait");
    expect(screen.getByTestId("apagar-no")).toBeTruthy();
  });

  it("clicar no botão chama quem decide a remoção", async () => {
    const { aoApagar } = montar("trigger.lead_created");
    await userEvent.click(screen.getByTestId("apagar-no"));
    expect(aoApagar).toHaveBeenCalledTimes(1);
  });
});
