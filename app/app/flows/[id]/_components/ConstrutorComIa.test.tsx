/**
 * O PAINEL, EXERCITADO COMO A PESSOA O USA — sem servidor.
 *
 * ## O que este arquivo é, e o que ele NÃO é
 *
 * É prova de COMPORTAMENTO da tela: clicar, ver o cartão de opção, ver o
 * esqueleto chegar ao canvas antes dos configs, ver o aviso de "valores padrão"
 * aparecer, ver a causa do servidor na tela em vez de uma frase genérica.
 *
 * NÃO é a prova pela tela que a doutrina de QA Visual exige — aquela é
 * Playwright em ambiente fresco estilo VPS. Ela não foi executada nesta sessão:
 * o Docker não sobe nesta máquina (`docker info` não encontra o daemon), então
 * não há banco do `baseline.sql` para o app conversar. A spec existe
 * (`tests/e2e/flow-builder-ia-montagem.spec.ts`) e está declarada no CI; o que
 * falta é a EXECUÇÃO, e ela está declarada como não medida no
 * `docs/testing/user-journey-map.md`.
 *
 * O valor deste arquivo é cobrir, sem depender de Docker, os três
 * comportamentos que o defeito original tornou críticos: a causa real do erro
 * chegar à tela, a aceitação parcial ser ANUNCIADA, e o esqueleto aparecer
 * antes dos configs.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConstrutorComIa } from "./ConstrutorComIa";

const postMock = vi.fn();
vi.mock("@/lib/api/client", () => ({
  apiClient: {
    post: (...args: unknown[]) => postMock(...args),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const PLANO = {
  blocos: [
    { id: "t1", tipo: "trigger.lead_created", rotulo: "Lead novo", intencao: "início" },
    { id: "w1", tipo: "logic.wait", rotulo: "Espera", intencao: "esperar 10 minutos" },
    { id: "tag", tipo: "crm.add_tag", rotulo: "Etiqueta", intencao: "marcar" },
  ],
  ligacoes: [
    { de: "t1", para: "w1" },
    { de: "w1", para: "tag" },
  ],
};

const GRAFO = {
  nodes: [
    { id: "t1", type: "trigger.lead_created", label: "Lead novo", position: { x: 0, y: 0 }, config: {} },
    {
      id: "w1",
      type: "logic.wait",
      label: "Espera",
      position: { x: 260, y: 0 },
      config: { duracao_ms: 600000 },
    },
    {
      id: "tag",
      type: "crm.add_tag",
      label: "Etiqueta",
      position: { x: 520, y: 0 },
      config: { tag: "novo" },
    },
  ],
  edges: [
    { id: "e1", source: "t1", target: "w1", branch_id: "else" },
    { id: "e2", source: "w1", target: "tag", branch_id: "else" },
  ],
};

function streamSse(eventos: readonly unknown[]): Response {
  const texto = eventos.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  const codificador = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(codificador.encode(texto));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function montarTela() {
  const canvas = vi.fn();
  const bloqueio = vi.fn();
  render(
    <ConstrutorComIa
      flowId="11111111-1111-4111-8111-111111111111"
      onAtualizarCanvas={canvas}
      grafoAntesDeGerar={() => ({ nos: [], arestas: [] })}
      onMudarBloqueio={bloqueio}
    />,
  );
  return { canvas, bloqueio };
}

/** Vai da porta fechada até o botão "Montar o fluxo" aparecer. */
async function ateOResumo(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("abrir-construtor-ia"));
  await user.type(screen.getByTestId("ia-pedido"), "avisa o vendedor quando o lead esfriar");
  await user.click(screen.getByTestId("ia-continuar"));
}

describe("ConstrutorComIa", () => {
  beforeEach(() => {
    postMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("mostra a pergunta como CARTÕES de escolha única, navegáveis por teclado", async () => {
    const user = userEvent.setup();
    postMock.mockResolvedValueOnce({
      data: { kind: "perguntar", pergunta: "Quanto tempo esperar?", opcoes: ["10 minutos", "1 hora"] },
    });
    montarTela();
    await ateOResumo(user);

    const opcoes = await screen.findAllByTestId("ia-opcao");
    expect(opcoes).toHaveLength(2);
    // A versão anterior eram botões soltos: para quem usa leitor de tela, nada
    // dizia que as opções eram uma escolha única.
    expect(opcoes[0]).toHaveAttribute("role", "radio");
    expect(screen.getByRole("radiogroup")).toBeInTheDocument();
  });

  it("o esqueleto chega ao canvas ANTES de qualquer config", async () => {
    const user = userEvent.setup();
    postMock
      .mockResolvedValueOnce({ data: { kind: "pronto", resumo: "Monto 3 blocos." } })
      .mockResolvedValueOnce({ data: PLANO });

    // O stream demora; a asserção é que o canvas já recebeu os 3 nós antes dele.
    let liberar: () => void = () => {};
    const espera = new Promise<void>((r) => (liberar = r));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await espera;
        return streamSse([{ tipo: "grafo", grafo: GRAFO }, { tipo: "fim", nos: 3, arestas: 2, comExemplo: 0 }]);
      }),
    );

    const { canvas } = montarTela();
    await ateOResumo(user);
    await user.click(await screen.findByTestId("ia-montar"));

    await waitFor(() => expect(canvas).toHaveBeenCalled());
    const primeiro = canvas.mock.calls[0]![0] as { nos: unknown[] };
    expect(
      primeiro.nos,
      "o canvas precisa receber o fluxo inteiro assim que o PLANO chega — é o que " +
        "faz o fluxo aparecer em segundos em vez de gotejar por um minuto",
    ).toHaveLength(3);
    liberar();
  });

  it("anuncia quantos blocos vieram com valores padrão", async () => {
    const user = userEvent.setup();
    postMock
      .mockResolvedValueOnce({ data: { kind: "pronto", resumo: "Monto 3 blocos." } })
      .mockResolvedValueOnce({ data: PLANO });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamSse([
          { tipo: "bloco", id: "t1", origem: "ia", restantes: 2 },
          { tipo: "bloco", id: "w1", origem: "exemplo", restantes: 1 },
          { tipo: "bloco", id: "tag", origem: "ia", restantes: 0 },
          { tipo: "grafo", grafo: GRAFO },
          { tipo: "fim", nos: 3, arestas: 2, comExemplo: 1 },
        ]),
      ),
    );

    montarTela();
    await ateOResumo(user);
    await user.click(await screen.findByTestId("ia-montar"));

    const aviso = await screen.findByTestId("ia-aviso-padrao");
    // Esconder isso seria repetir o pecado que esta frente veio consertar: um
    // bloco com valores padrão PARECE pronto e não está.
    expect(aviso).toHaveTextContent("1");
  });

  it("mostra a CAUSA do servidor quando o plano falha, não uma frase genérica", async () => {
    const user = userEvent.setup();
    postMock
      .mockResolvedValueOnce({ data: { kind: "pronto", resumo: "Monto 3 blocos." } })
      .mockRejectedValueOnce(
        new Error("Nenhum provedor de IA está configurado nesta organização."),
      );

    const { bloqueio } = montarTela();
    await ateOResumo(user);
    await user.click(await screen.findByTestId("ia-montar"));

    const erro = await screen.findByTestId("ia-erro");
    expect(erro).toHaveTextContent(/Nenhum provedor de IA/);
    // E a tela destrava: erro não pode deixar a paleta e o Salvar mortos.
    await waitFor(() => expect(bloqueio).toHaveBeenLastCalledWith(false));
  });
});
