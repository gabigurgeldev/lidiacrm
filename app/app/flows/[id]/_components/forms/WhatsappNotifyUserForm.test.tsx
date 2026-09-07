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

import { notifyUserConfigSchema } from "@/lib/flow-engine/nodes/avisos";

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

  it("⭐ config nunca tocada AINDA publica — o destinatário tem default no schema", () => {
    // A versão anterior deste caso media outra coisa: o formulário regravava
    // `destinatario` a cada tecla, porque não havia campo para ele. Agora há —
    // e a garantia mudou de lugar, não sumiu. Quem responde por um bloco que
    // ninguém abriu é o schema.
    const lido = notifyUserConfigSchema.safeParse({ mensagem: "Oi" });
    expect(lido.success, "bloco de aviso não publica sem alguém abrir o painel").toBe(true);
    if (lido.success) expect(lido.data.destinatario).toEqual({ tipo: "dono_do_lead" });
  });

  it("escolher número fixo mostra o campo do telefone", () => {
    montar({ mensagem: "Oi", destinatario: { tipo: "telefone", telefone: "+5511999998888" } });
    expect(screen.getByTestId("campo-telefone-do-aviso")).toHaveValue("+5511999998888");
  });

  it("com o dono do lead, o campo do telefone NÃO aparece", () => {
    // Oferecer o campo aqui faria parecer que dá para escrever um número que o
    // bloco vai ignorar — o telefone vem do cadastro da pessoa.
    montar({ mensagem: "Oi", destinatario: { tipo: "dono_do_lead" } });
    expect(screen.queryByTestId("campo-telefone-do-aviso")).not.toBeInTheDocument();
  });

  it("editar o telefone preserva o tipo do destinatário", async () => {
    const { aoMudarConfig } = montar({
      mensagem: "Oi",
      destinatario: { tipo: "telefone", telefone: "+551199999888" },
    });
    await userEvent.type(screen.getByTestId("campo-telefone-do-aviso"), "8");
    const ultimo = aoMudarConfig.mock.calls.at(-1)?.[0] as {
      destinatario: { tipo: string; telefone: string };
    };
    expect(ultimo.destinatario.tipo).toBe("telefone");
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
