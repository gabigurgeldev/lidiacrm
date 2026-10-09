/**
 * O botão Testar do agente ensaia O QUE ESTÁ NA TELA — sem salvar.
 *
 * Duas pontas, e um teste para cada:
 *
 *  1. o `AgentForm` avisa a versão viva a cada edição (`aoMudarVersao`) — o
 *     painel de teste nunca enxerga o último SALVO quando a tela já mudou;
 *  2. o `TestPanel` manda essa versão ao ensaio, mostra o que o agente
 *     responderia como "não enviada", e continua a conversa com o histórico.
 *
 * O ensaio em si (o turno de produção numa transação desfeita) é provado contra
 * Postgres em `tests/invariants/ensaio-nao-deixa-rastro.test.ts`.
 *
 * Sabotagens medidas: tirar o efeito `aoMudarVersao` do AgentForm deixa o
 * primeiro caso vermelho; mandar a conversa sem a resposta anterior do agente
 * (sem `conversaDepois`) deixa o terceiro vermelho.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/app/ai/agents/a1",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (texto: string) => texto }));

import { AgentForm, type VersaoDoFormulario } from "@/app/app/ai/agents/[id]/_components/AgentForm";
import { TestPanel } from "@/app/app/ai/agents/[id]/_components/TestPanel";
import type { RelatorioDoEnsaio } from "@/lib/ai/agents/leitura-do-ensaio";

const SESSAO = "22222222-2222-4222-8222-222222222222";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("o formulário avisa a versão viva", () => {
  it("cada edição chega ao painel de teste, sem salvar", () => {
    const avisos: VersaoDoFormulario[] = [];
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <AgentForm
          mode="create"
          credentials={[]}
          channelSessions={[{ id: SESSAO, label: "WhatsApp", status: "WORKING" }] as never}
          aoMudarVersao={(v) => avisos.push(v)}
        />
      </QueryClientProvider>,
    );
    const prompt = screen
      .getAllByRole("textbox")
      .find((el) => el.tagName === "TEXTAREA" && el.className.includes("font-mono")) as HTMLTextAreaElement;

    fireEvent.change(prompt, { target: { value: "Você atende a pizzaria do Zé. Seja breve." } });

    expect(avisos.at(-1)?.system_prompt).toBe("Você atende a pizzaria do Zé. Seja breve.");
    // As consultas do formulário seguem vivas depois do cleanup; sem isto elas
    // chamam o `fetch` do caso seguinte.
    qc.clear();
  });
});

function versaoValida(): VersaoDoFormulario {
  return {
    system_prompt: "Você atende a pizzaria do Zé. Seja breve.",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    credential_id: null,
    tool_ids: [],
    channel_session_id: SESSAO,
  } as unknown as VersaoDoFormulario;
}

function relatorio(mensagens: string[]): RelatorioDoEnsaio {
  return {
    id: "e1",
    desfecho: "respondeu",
    mensagens: mensagens.map((texto) => ({ texto, template: false })),
    ferramentas: [{ ferramenta: "crm_list_pipelines", entrada: {}, resultado: {}, simulada: true }],
    conferencias: [{ trace: [{ gate: "stop", verdict: "pass" }], barradaPor: null, codigo: null }],
    estado: { etapa: null, proximaAcao: null, resumo: null, notas: [] },
    avisos: [],
    adiamento: null,
    erro: null,
    custo: { chamadas: 2, centavos: 0.3, semPreco: 0, falhas: 0, tokensDeEntrada: 900, tokensDeSaida: 40 },
    esperasMs: [],
    duracaoMs: 1200,
  };
}

function falar(texto: string) {
  fireEvent.change(screen.getByLabelText("Mensagem do cliente"), { target: { value: texto } });
  fireEvent.click(screen.getByTestId("ensaio-enviar"));
}

/**
 * `fetch` falso que responde SÓ ao ensaio, na ordem dada, e guarda os corpos.
 * Outra chamada qualquer (uma consulta perdida de outro componente) recebe
 * vazio e não consome a resposta do ensaio.
 */
function ensaioFalso(...respostas: Array<{ status?: number; corpo: unknown }>) {
  const pedidos: Array<{ url: string; corpo: Record<string, unknown> }> = [];
  const fila = [...respostas];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (!String(url).endsWith("/ensaio")) return new Response("{}");
      pedidos.push({ url: String(url), corpo: JSON.parse(String(init?.body)) });
      const r = fila.shift() ?? { status: 500, corpo: {} };
      return new Response(JSON.stringify(r.corpo), { status: r.status ?? 200 });
    }),
  );
  return pedidos;
}

describe("o painel de teste", () => {
  it("manda o formulário não salvo ao ensaio e mostra a resposta como não enviada", async () => {
    const pedidos = ensaioFalso({ corpo: { data: relatorio(["Temos sim! 🍕"]) } });
    render(<TestPanel agent={{ id: "a1" } as never} versao={versaoValida()} />);

    falar("Vocês entregam no centro?");

    await screen.findByTestId("ensaio-bolha-agente", {}, { timeout: 5000 });
    expect(pedidos[0]!.url).toBe("/api/v1/ai/agents/a1/ensaio");
    const corpo = pedidos[0]!.corpo as { versao: { system_prompt: string }; conversa: unknown };
    expect(corpo.versao.system_prompt).toBe("Você atende a pizzaria do Zé. Seja breve.");
    expect(corpo.conversa).toEqual([{ de: "cliente", texto: "Vocês entregam no centro?" }]);
    expect(screen.getByTestId("ensaio-bolha-agente")).toHaveTextContent("Temos sim! 🍕");
    expect(screen.getByTestId("ensaio-bolha-agente")).toHaveTextContent("não enviada");
    expect(screen.getByTestId("ensaio-desfecho")).toHaveAttribute("data-desfecho", "respondeu");
    expect(screen.getByTestId("ensaio-ferramentas")).toHaveTextContent("simulada");
  });

  it("formulário sem número não testa — e diz por quê", () => {
    ensaioFalso();
    const semNumero = { ...versaoValida(), channel_session_id: "" } as VersaoDoFormulario;
    render(<TestPanel agent={{ id: "a1" } as never} versao={semNumero} />);

    expect(screen.getByTestId("ensaio-formulario-invalido")).toHaveTextContent("Escolha o número de WhatsApp do agente.");
    expect(screen.getByLabelText("Mensagem do cliente")).toBeDisabled();
  });

  it("a segunda fala do cliente leva a resposta anterior do agente no histórico", async () => {
    const pedidos = ensaioFalso(
      { corpo: { data: relatorio(["Entregamos sim."]) } },
      { corpo: { data: relatorio(["R$ 8."]) } },
    );
    render(<TestPanel agent={{ id: "a1" } as never} versao={versaoValida()} />);

    falar("Vocês entregam no centro?");
    await screen.findByText("Entregamos sim.", {}, { timeout: 5000 });
    // O campo fica travado enquanto o teste roda; a segunda fala só entra depois.
    await waitFor(() => expect(screen.getByLabelText("Mensagem do cliente")).not.toBeDisabled());
    falar("Quanto é a taxa?");
    await screen.findByText("R$ 8.", {}, { timeout: 5000 });

    expect(pedidos[1]!.corpo.conversa).toEqual([
      { de: "cliente", texto: "Vocês entregam no centro?" },
      { de: "agente", texto: "Entregamos sim." },
      { de: "cliente", texto: "Quanto é a taxa?" },
    ]);
  });

  it("erro do servidor aparece com a mensagem dele", async () => {
    ensaioFalso({ status: 409, corpo: { error: { message: "já há um ensaio rodando" } } });
    render(<TestPanel agent={{ id: "a1" } as never} versao={versaoValida()} />);
    falar("oi");
    await waitFor(() => expect(screen.getByTestId("ensaio-erro")).toHaveTextContent("já há um ensaio rodando"));
  });
});
