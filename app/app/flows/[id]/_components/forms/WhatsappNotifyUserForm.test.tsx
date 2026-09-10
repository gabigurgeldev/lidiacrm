/**
 * O formulário do aviso ao vendedor, depois da mudança de casa.
 *
 * ## Por que ESTE formulário e não outro
 *
 * Ele é o único da leva migrada que grava um campo que a pessoa NÃO vê: junto
 * da mensagem, ele sempre regrava `destinatario: { tipo: "dono_do_lead" }`.
 * O motor recusa a config sem esse campo.
 *
 * (Este parágrafo dizia que o bloco tinha "uma segunda opção de destinatário que
 * ainda não existe", citando `destinatario_fixo_ainda_nao_suportado`. Era
 * verdade e deixou de ser: as TRÊS opções funcionam desde 2026-09-10, e a que
 * devolvia `dead` era justamente a que matava a execução em silêncio.)
 *
 * Numa migração de dezesseis formulários entre arquivos, o campo invisível é
 * exatamente o que se perde sem ninguém notar: a tela continua idêntica, o
 * fluxo salva, e a publicação recusa depois — longe de quem escreveu a
 * mensagem. Este arquivo é o que reprova essa perda.
 *
 * Cobre também os primitivos compartilhados (`Secao`/`Campo`/`Dica`), que agora
 * servem os dezesseis formulários: um erro neles quebra todos de uma vez.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { notifyUserConfigSchema } from "@/lib/flow-engine/nodes/avisos";

import { WhatsappNotifyUserForm } from "./WhatsappNotifyUserForm";

// O formulário passou a ler duas listas do servidor — a equipe (para avisar uma
// PESSOA) e as conexões (para escolher por qual número o aviso sai). As duas
// entram por react-query, então o teste precisa do provider; sem ele o render
// morre com "No QueryClient set", que não é defeito do formulário.
vi.mock("@/lib/api/client", () => ({ apiClient: { get: vi.fn(async () => ({ data: [] })) } }));

function montar(config: Record<string, unknown> = {}) {
  const aoMudarConfig = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  render(<WhatsappNotifyUserForm config={config} aoMudarConfig={aoMudarConfig} />, {
    wrapper: Wrapper,
  });
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

  it("⭐ tem onde escolher POR QUAL número o aviso sai", () => {
    // O defeito que este caso barra: o bloco mandava sempre pela conexão mais
    // antiga da organização, e não havia campo nenhum para escolher outra.
    montar({ mensagem: "Oi" });
    expect(screen.getByText(/Por onde enviar/i)).toBeInTheDocument();
  });

  it("⭐ com destinatário por PESSOA, a tela mostra onde escolher quem", () => {
    // A opção existia no schema e matava a execução; a tela nem a mostrava.
    //
    // Mede o EFEITO de escolher, e não o clique no menu: o Select do design
    // system é Radix, que não abre em jsdom (depende de pointer capture). Quem
    // prova que a opção está no menu e é clicável é o e2e, em browser de
    // verdade — `tests/e2e/flow-blocos-do-paralelo.spec.ts`.
    montar({ mensagem: "Oi", destinatario: { tipo: "usuario", user_id: "u1" } });
    expect(screen.getByText(/Quem da equipe recebe o aviso/i)).toBeInTheDocument();
    // E o campo de número fixo NÃO aparece junto: são destinatários exclusivos.
    expect(screen.queryByTestId("campo-telefone-do-aviso")).not.toBeInTheDocument();
  });

  it("com a equipe vazia, DIZ o que fazer em vez de mostrar uma caixa vazia", () => {
    // `apiClient.get` devolve lista vazia neste teste — que é o estado de uma
    // instalação recém-criada, e o pior momento para a tela ficar muda.
    montar({ mensagem: "Oi", destinatario: { tipo: "usuario", user_id: "" } });
    expect(screen.getByTestId("sem-equipe-para-avisar")).toBeInTheDocument();
  });
});
