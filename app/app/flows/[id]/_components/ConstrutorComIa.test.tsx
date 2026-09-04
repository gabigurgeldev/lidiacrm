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

/**
 * `quadroAtual` vazio por padrão: é o estado de um fluxo recém-criado, e é o
 * que a maioria dos casos exercita. Passar um grafo com blocos liga o caminho
 * do AJUSTE — a tela oferece "ajustar" só quando há o que ajustar.
 */
function montarTela(quadroAtual: { nodes: unknown[]; edges: unknown[] } = { nodes: [], edges: [] }) {
  const canvas = vi.fn();
  const bloqueio = vi.fn();
  const anterior = { nos: [{ id: "velho" }], arestas: [] } as never;
  render(
    <ConstrutorComIa
      flowId="11111111-1111-4111-8111-111111111111"
      onAtualizarCanvas={canvas}
      grafoAntesDeGerar={() => anterior}
      grafoAtual={() => quadroAtual as never}
      onMudarBloqueio={bloqueio}
    />,
  );
  return { canvas, bloqueio, anterior };
}

/** Vai da porta fechada até a IA responder a primeira vez. */
async function ateOResumo(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("abrir-construtor-ia"));
  await user.type(screen.getByTestId("ia-pedido"), "avisa o vendedor quando o lead esfriar");
  await user.click(screen.getByTestId("ia-continuar"));
}

/**
 * Segue do resumo até a montagem começar.
 *
 * ⚠️ HÁ UM PASSO A MAIS AQUI, e ele É a feature. Antes, "Montar o fluxo"
 * aparecia direto no resumo e disparava plano + montagem coladas: a pessoa
 * aceitava a substituição do quadro dela tendo lido uma frase. Hoje ela vê a
 * lista de blocos antes — este helper existe porque o passo é obrigatório.
 */
async function ateMontar(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByTestId("ia-ver-plano"));
  await user.click(await screen.findByTestId("ia-montar"));
}

// No topo, e não dentro de um `describe`: o arquivo tem três blocos, e um
// reset preso ao primeiro deixa os outros herdando as chamadas do anterior —
// o sintoma é "esperava 2 chamadas, recebeu 8".
beforeEach(() => {
  postMock.mockReset();
});

describe("ConstrutorComIa", () => {
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
    await ateMontar(user);

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
    await ateMontar(user);

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
    // Só "ver o plano": é a chamada que falha, e o botão de montar nunca chega
    // a existir — que é justamente o comportamento a provar.
    await user.click(await screen.findByTestId("ia-ver-plano"));

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
    await ateMontar(user);

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

describe("responder sem cartão", () => {
  it("dá para DIGITAR a resposta, mesmo quando há opções", async () => {
    // ⚠️ O servidor recusava toda pergunta com menos de 2 opções, então para
    // perguntar "qual o texto da mensagem?" o modelo tinha de inventar três
    // textos — e a pessoa escolhia entre frases que não eram as dela.
    const user = userEvent.setup();
    postMock
      .mockResolvedValueOnce({
        data: { kind: "perguntar", pergunta: "Qual etiqueta?", opcoes: ["quente", "frio"] },
      })
      .mockResolvedValueOnce({ data: { kind: "pronto", resumo: "Monto 3 blocos." } });

    montarTela();
    await ateOResumo(user);

    await user.type(await screen.findByTestId("ia-resposta-livre"), "lead-vip");
    await user.click(screen.getByTestId("ia-enviar-resposta"));

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(2));
    const corpo = postMock.mock.calls[1]![1] as { historico: { texto: string }[] };
    expect(
      corpo.historico.map((m) => m.texto),
      "o que a pessoa escreveu tem de chegar ao modelo como resposta dela",
    ).toContain("lead-vip");
  });

  it("pergunta ABERTA vem sem cartão nenhum, e ainda assim tem caminho", async () => {
    const user = userEvent.setup();
    postMock.mockResolvedValueOnce({
      data: {
        kind: "perguntar",
        pergunta: "Qual o texto da mensagem?",
        opcoes: [],
        resposta_livre: true,
      },
    });

    montarTela();
    await ateOResumo(user);

    expect(await screen.findByTestId("ia-resposta-livre")).toBeInTheDocument();
    expect(screen.queryAllByTestId("ia-opcao")).toHaveLength(0);
  });

  it('"não tenho preferência" é uma resposta, não um abandono', async () => {
    const user = userEvent.setup();
    postMock
      .mockResolvedValueOnce({
        data: { kind: "perguntar", pergunta: "Quanto esperar?", opcoes: ["10 min", "1 hora"] },
      })
      .mockResolvedValueOnce({ data: { kind: "pronto", resumo: "Monto 3 blocos." } });

    montarTela();
    await ateOResumo(user);
    await user.click(await screen.findByTestId("ia-pular"));

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(2));
    const corpo = postMock.mock.calls[1]![1] as { historico: { texto: string }[] };
    expect(corpo.historico).toHaveLength(2);
  });

  it("corrigir a última resposta remove o par e pergunta de novo", async () => {
    // Sem isto, clicar na opção errada obrigava a fechar o painel e recomeçar a
    // descrição do zero — e a conversa não é persistida, então é literal.
    const user = userEvent.setup();
    postMock
      .mockResolvedValueOnce({
        data: { kind: "perguntar", pergunta: "Quanto esperar?", opcoes: ["10 min", "1 hora"] },
      })
      .mockResolvedValueOnce({ data: { kind: "pronto", resumo: "Monto 3 blocos." } })
      .mockResolvedValueOnce({
        data: { kind: "perguntar", pergunta: "Quanto esperar?", opcoes: ["10 min", "1 hora"] },
      });

    montarTela();
    await ateOResumo(user);
    await user.click((await screen.findAllByTestId("ia-opcao"))[0]!);

    await user.click(await screen.findByTestId("ia-corrigir"));

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(3));
    const corpo = postMock.mock.calls[2]![1] as { historico: unknown[] };
    expect(corpo.historico, "o par pergunta/resposta tinha de sair do histórico").toHaveLength(0);
  });
});

describe("ver antes de aceitar, e descartar depois", () => {
  it("lista os blocos do plano ANTES de substituir o quadro", async () => {
    const user = userEvent.setup();
    postMock
      .mockResolvedValueOnce({ data: { kind: "pronto", resumo: "Monto 3 blocos." } })
      .mockResolvedValueOnce({ data: PLANO });

    const { canvas } = montarTela();
    await ateOResumo(user);
    await user.click(await screen.findByTestId("ia-ver-plano"));

    const lista = await screen.findByTestId("ia-plano");
    expect(lista).toHaveTextContent("Espera");
    // A intenção é o que permite conferir: "Espera" sozinho não diz 10 minutos.
    expect(lista).toHaveTextContent("esperar 10 minutos");
    expect(
      canvas,
      "o quadro da pessoa não pode ser tocado antes de ela ver o que vem",
    ).not.toHaveBeenCalled();
  });

  it("descartar DEPOIS de pronto devolve o quadro anterior", async () => {
    // Antes só dava para desfazer DURANTE a montagem — que é justamente quando
    // a pessoa ainda não sabe se gostou do resultado.
    const user = userEvent.setup();
    postMock
      .mockResolvedValueOnce({ data: { kind: "pronto", resumo: "Monto 3 blocos." } })
      .mockResolvedValueOnce({ data: PLANO })
      .mockResolvedValueOnce({ data: { grafo: GRAFO, comExemplo: 0, descartes: [] } });

    const { canvas, anterior } = montarTela();
    await ateOResumo(user);
    await ateMontar(user);

    await user.click(await screen.findByTestId("ia-descartar"));

    expect(canvas).toHaveBeenLastCalledWith(anterior);
  });

  it("o que ficou pendente aparece na tela, e não no botão Publicar", async () => {
    const user = userEvent.setup();
    postMock
      .mockResolvedValueOnce({ data: { kind: "pronto", resumo: "Monto 3 blocos." } })
      .mockResolvedValueOnce({ data: PLANO })
      .mockResolvedValueOnce({
        data: {
          grafo: GRAFO,
          comExemplo: 0,
          descartes: [],
          consertos: [{ ancora: "w1", oQueFoiFeito: "A saída solta passou a terminar o fluxo." }],
          pendencias: [
            { ancora: "tag", codigo: "ramo_sem_saida", mensagem: 'A saída "Sim" não leva a lugar nenhum.' },
          ],
        },
      });

    montarTela();
    await ateOResumo(user);
    await ateMontar(user);

    expect(await screen.findByTestId("ia-pendencias")).toHaveTextContent('A saída "Sim"');
    // O conserto automático também é dito: ele mexeu em ligação, e conserto
    // silencioso vira "eu não pedi isso".
    expect(screen.getByTestId("ia-consertos")).toHaveTextContent("terminar o fluxo");
  });
});

describe("ajustar o fluxo que já está no quadro", () => {
  const QUADRO_CHEIO = { nodes: GRAFO.nodes, edges: GRAFO.edges };

  it("com o quadro VAZIO não oferece ajustar — não há o que ajustar", async () => {
    const user = userEvent.setup();
    montarTela();
    await user.click(screen.getByTestId("abrir-construtor-ia"));

    expect(screen.queryByTestId("ia-ajustar")).not.toBeInTheDocument();
    expect(screen.getByTestId("ia-continuar")).toBeInTheDocument();
  });

  it("com blocos no quadro, ajustar vai DIRETO à rota de ajuste", async () => {
    // Sem passar por `interpretar` nem pela lista do plano: o pedido é uma
    // alteração sobre um fluxo que a pessoa está vendo na tela.
    const user = userEvent.setup();
    postMock.mockResolvedValueOnce({
      data: { grafo: GRAFO, comExemplo: 0, descartes: [], preservados: 2, regerados: 1 },
    });

    const { canvas } = montarTela(QUADRO_CHEIO);
    await user.click(screen.getByTestId("abrir-construtor-ia"));
    await user.type(screen.getByTestId("ia-pedido"), "a espera passa a ser de 1 hora");
    await user.click(screen.getByTestId("ia-ajustar"));

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(postMock.mock.calls[0]![0]).toContain("/ai/ajustar");
    expect(postMock.mock.calls[0]![1]).toMatchObject({ pedido: "a espera passa a ser de 1 hora" });
    await waitFor(() => expect(canvas).toHaveBeenCalled());
  });

  it("depois do ajuste dá para descartar e voltar ao quadro anterior", async () => {
    const user = userEvent.setup();
    postMock.mockResolvedValueOnce({ data: { grafo: GRAFO, comExemplo: 0, descartes: [] } });

    const { canvas, anterior } = montarTela(QUADRO_CHEIO);
    await user.click(screen.getByTestId("abrir-construtor-ia"));
    await user.type(screen.getByTestId("ia-pedido"), "tira a etiqueta");
    await user.click(screen.getByTestId("ia-ajustar"));

    await user.click(await screen.findByTestId("ia-descartar"));
    expect(canvas).toHaveBeenLastCalledWith(anterior);
  });
});
