/**
 * O formulário do aviso ao vendedor, depois da mudança de casa.
 *
 * ## Por que ESTE formulário e não outro
 *
 * Ele é o único da leva migrada que grava um campo que a pessoa NÃO vê: junto
 * da mensagem, ele sempre regrava `destinatario: { tipo: "dono_do_lead" }`.
 * O motor recusa a config sem esse campo, e o bloco tem uma segunda opção de
 * destinatário que ainda não existe (`destinatario_fixo_ainda_nao_suportado`,
 * em `lib/flow-engine/nodes/avisos.ts`).
 *
 * Numa migração de dezesseis formulários entre arquivos, o campo invisível é
 * exatamente o que se perde sem ninguém notar: a tela continua idêntica, o
 * fluxo salva, e a publicação recusa depois — longe de quem escreveu a
 * mensagem. Este arquivo é o que reprova essa perda.
 *
 * Cobre também os primitivos compartilhados (`Secao`/`Campo`/`Dica`), que agora
 * servem os dezesseis formulários: um erro neles quebra todos de uma vez.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WhatsappNotifyUserForm } from "./WhatsappNotifyUserForm";

function montar(config: Record<string, unknown> = {}) {
  const aoMudarConfig = vi.fn();
  render(<WhatsappNotifyUserForm config={config} aoMudarConfig={aoMudarConfig} />);
  return { aoMudarConfig };
}

describe("o formulário do aviso ao vendedor", () => {
  it("abre com o campo da mensagem, e não com um painel vazio", () => {
    montar();
    expect(screen.getByTestId("campo-mensagem-do-aviso")).toBeInTheDocument();
  });

  it("⭐ ao escrever, grava JUNTO o destinatário que o motor exige", async () => {
    const { aoMudarConfig } = montar({ mensagem: "" });
    await userEvent.type(screen.getByTestId("campo-mensagem-do-aviso"), "O");

    const ultimo = aoMudarConfig.mock.calls.at(-1)?.[0] as {
      mensagem: string;
      destinatario: { tipo: string };
    };
    expect(ultimo.mensagem).toBe("O");
    expect(
      ultimo.destinatario,
      "sem `destinatario` a config não publica, e o campo não aparece na tela para a pessoa notar",
    ).toEqual({ tipo: "dono_do_lead" });
  });

  it("preserva o resto da config em vez de substituí-la", async () => {
    // O formulário recebe a config INTEIRA e devolve a config inteira. Um
    // `aoMudarConfig({ mensagem })` seco apagaria tudo o que não fosse mensagem.
    const { aoMudarConfig } = montar({ mensagem: "", enfeite_futuro: 42 });
    await userEvent.type(screen.getByTestId("campo-mensagem-do-aviso"), "x");
    const ultimo = aoMudarConfig.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(ultimo.enfeite_futuro).toBe(42);
  });

  it("explica de onde sai o telefone e o que acontece sem ele", () => {
    montar();
    // A saída "Sem telefone cadastrado" existe no motor; se a tela não a
    // menciona, quem monta descobre o ramo pendurado só ao ver o quadro.
    expect(screen.getByText(/Sem telefone cadastrado/i)).toBeInTheDocument();
  });
});
