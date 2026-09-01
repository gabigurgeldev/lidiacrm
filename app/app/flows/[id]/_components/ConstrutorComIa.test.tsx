/**
 * O PAINEL, EXERCITADO COMO A PESSOA O USA — sem servidor.
 *
 * ## O que este arquivo é, e o que ele NÃO é
 *
 * É prova de COMPORTAMENTO da tela: clicar, ver o cartão de opção, ver o
 * esqueleto chegar ao canvas antes dos configs, ver o aviso de "valores padrão"
 * aparecer, ver a causa do servidor na tela em vez de uma frase genérica, e —
 * o caso novo — ver que uma falha na montagem NÃO apaga o esqueleto.
 *
 * NÃO é a prova pela tela que a doutrina de QA Visual exige — aquela é
 * Playwright em ambiente fresco estilo VPS. Ela não foi executada nesta sessão:
 * o Docker não sobe nesta máquina (`docker ps` não encontra o daemon), então não
 * há banco do `baseline.sql` para o app conversar. A spec existe
 * (`tests/e2e/flow-builder-ia-montagem.spec.ts`) e está declarada no CI; o que
 * falta é a EXECUÇÃO, e ela está declarada como não medida no
 * `docs/testing/user-journey-map.md`.
 *
 * ## ⚠️ ESTE ARQUIVO STUBAVA `fetch` COM UM STREAM SSE
 *
 * A rota de montagem deixou de ser `text/event-stream` — numa VPS real o stream
 * não atravessava o proxy e a tela travava em "Montando N blocos…" para sempre.
 * As duas etapas passaram a ser POST JSON, então as duas passam pelo
 * `apiClient`, e o `fetch` global saiu daqui junto com o SSE.
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

function montarTela() {
  const canvas = vi.fn();
  const bloqueio = vi.fn();
  const anterior = { nos: [{ id: "velho" }], arestas: [] } as never;
  render(
    <ConstrutorComIa
      flowId="11111111-1111-4111-8111-111111111111"
      onAtualizarCanvas={canvas}
      grafoAntesDeGerar={() => anterior}
      onMudarBloqueio={bloqueio}
    />,
  );
  return { canvas, bloqueio, anterior };
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
    let liberar: (v: unknown) => void = () => {};
    postMock
      .mockResolvedValueOnce({ data: { kind: "pronto", resumo: "Monto 3 blocos." } })
      .mockResolvedValueOnce({ data: PLANO })
      // A montagem demora; a asserção é que o canvas já recebeu os 3 nós antes.
      .mockImplementationOnce(() => new Promise((r) => (liberar = r)));

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
    liberar({ data: { grafo: GRAFO, comExemplo: 0, descartes: [] } });
  });

  it("anuncia quantos blocos vieram com valores padrão", async () => {
    const user = userEvent.setup();
    postMock
      .mockResolvedValueOnce({ data: { kind: "pronto", resumo: "Monto 3 blocos." } })
      .mockResolvedValueOnce({ data: PLANO })
      .mockResolvedValueOnce({ data: { grafo: GRAFO, comExemplo: 1, descartes: [] } });

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

  it("falhar a MONTAGEM não apaga o esqueleto do quadro", async () => {
    // O caso que a troca de transporte tornou possível — e obrigatório.
    //
    // Antes, qualquer falha restaurava o snapshot anterior e a pessoa perdia até
    // o esqueleto: um grafo válido, com os blocos certos ligados, em valores
    // padrão, que ela poderia terminar à mão. Apagar trabalho utilizável para
    // mostrar uma mensagem de erro é o oposto do que este painel deve fazer.
    const user = userEvent.setup();
    postMock
      .mockResolvedValueOnce({ data: { kind: "pronto", resumo: "Monto 3 blocos." } })
      .mockResolvedValueOnce({ data: PLANO })
      .mockRejectedValueOnce(new Error("A montagem falhou no meio. Tente de novo."));

    const { canvas, anterior } = montarTela();
    await ateOResumo(user);
    await user.click(await screen.findByTestId("ia-montar"));

    // A tela DIZ que os blocos ficaram lá — sem esta frase a pessoa lê "falhou",
    // fecha o painel e não repara no fluxo que sobrou.
    const nota = await screen.findByTestId("ia-so-esqueleto");
    expect(nota).toHaveTextContent("3");
    expect(screen.getByTestId("ia-preencher-a-mao")).toBeInTheDocument();

    // E a asserção que separa "diz" de "faz": o canvas NUNCA volta ao estado
    // anterior. Sem ela, a frase acima poderia estar mentindo.
    const voltouAoAnterior = canvas.mock.calls.some((c) => c[0] === anterior);
    expect(voltouAoAnterior, "o esqueleto não pode ser desfeito por uma falha").toBe(false);
  });
});
