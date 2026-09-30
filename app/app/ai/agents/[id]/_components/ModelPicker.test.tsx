/**
 * OS TRÊS ESTADOS de "sem modelo na lista" — o defeito medido em produção era
 * um deles colapsando nos outros dois: OpenRouter com a chave validada e
 * "Nenhum modelo disponível" na tela, quando a causa real era o catálogo
 * (`ai_models`, global da instalação) nunca ter sido sincronizado.
 *
 * A REGRA é testada direto por `estadoDoPicker`, sem abrir o `<Select>`: o
 * Radix não abre em jsdom (`target.hasPointerCapture is not a function`) —
 * mesma decisão de `EdgeConfigPanel.test.tsx`. O botão de sincronizar, que
 * fica FORA do `<Select>` (nunca precisa do popover abrir), é o único trecho
 * exercitado pela árvore de verdade.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { estadoDoPicker, ModelPicker, ofereceUsarCodigo, precoLegivel } from "./ModelPicker";

describe("estadoDoPicker — a regra isolada da árvore", () => {
  it("⭐ carregando não é 'vazio', mesmo com zero modelos ainda", () => {
    expect(
      estadoDoPicker({ totalDeModelos: 0, carregando: true, comErro: false, sincronizavel: true }),
    ).toBe("com_opcoes");
  });

  it("⭐ erro NUNCA vira 'nenhum modelo' — são ações diferentes para a pessoa", () => {
    expect(
      estadoDoPicker({ totalDeModelos: 0, carregando: false, comErro: true, sincronizavel: true }),
    ).toBe("erro");
  });

  it("⭐ vazio + sincronizável (o caso do defeito: OpenRouter sem sync) pede o botão", () => {
    expect(
      estadoDoPicker({ totalDeModelos: 0, carregando: false, comErro: false, sincronizavel: true }),
    ).toBe("vazio_sem_sync");
  });

  it("⭐ vazio + NÃO sincronizável (Anthropic sem modelo de fato) não promete sync", () => {
    expect(
      estadoDoPicker({ totalDeModelos: 0, carregando: false, comErro: false, sincronizavel: false }),
    ).toBe("vazio_de_verdade");
  });

  it("com modelos, o motivo do vazio não importa", () => {
    expect(
      estadoDoPicker({ totalDeModelos: 3, carregando: false, comErro: false, sincronizavel: true }),
    ).toBe("com_opcoes");
  });
});

const get = vi.fn();
const post = vi.fn();
vi.mock("@/lib/api/client", () => ({
  apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
}));

function montar(provider: "openrouter" | "anthropic") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ModelPicker provider={provider} value="" onChange={() => {}} id="modelo" />
    </QueryClientProvider>,
  );
}

describe("ModelPicker — o botão de sincronizar (fora do Select, DOM normal)", () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });

  it("⭐ aparece quando OpenRouter está vazio", async () => {
    get.mockResolvedValue({ data: { models: [] } });
    montar("openrouter");

    expect(await screen.findByText("Sincronizar catálogo agora")).toBeInTheDocument();
  });

  it("⭐ NÃO aparece para Anthropic vazio — a rota recusaria com 422", async () => {
    get.mockResolvedValue({ data: { models: [] } });
    montar("anthropic");

    // Espera a consulta assentar antes de afirmar ausência — senão o teste
    // passaria também com o componente ainda carregando.
    await screen.findByRole("combobox");
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.queryByText("Sincronizar catálogo agora")).not.toBeInTheDocument();
  });
});

describe("regras da busca na origem", () => {
  it("⭐ 'usar o código' só aparece para termo com cara de código e sem resultado exato", () => {
    expect(ofereceUsarCodigo("moonshotai/kimi-k3", [])).toBe(true);
    expect(ofereceUsarCodigo("moonshotai/kimi-k3", [{ model_id: "moonshotai/kimi-k3" }])).toBe(false);
    expect(ofereceUsarCodigo("sonnet", [])).toBe(false);
    expect(ofereceUsarCodigo("fabricante/ com espaço", [])).toBe(false);
  });

  it("preço desconhecido é '?', nunca grátis", () => {
    expect(precoLegivel(null)).toBe("?");
    expect(precoLegivel(0)).toBe("US$ 0,00");
    expect(precoLegivel(1500)).toBe("US$ 15,00");
  });
});

describe("ModelPicker — busca na OpenRouter (fora do Select, DOM normal)", () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });

  function montarCom(onChange: (id: string) => void, provider: "openrouter" | "anthropic" = "openrouter") {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <ModelPicker provider={provider} value="" onChange={onChange} id="modelo" />
      </QueryClientProvider>,
    );
  }

  it("⭐ achar o modelo novo e clicar grava no catálogo e escolhe ele", async () => {
    get.mockImplementation(async (url: string) =>
      url.includes("/search")
        ? {
            data: {
              models: [
                {
                  model_id: "moonshotai/kimi-k3",
                  display_name: "MoonshotAI: Kimi K3",
                  context_window: 256000,
                  input_price_per_million_cents: 60,
                  output_price_per_million_cents: 250,
                  supports_tools: true,
                  no_catalogo: false,
                },
              ],
            },
          }
        : { data: { models: [{ model_id: "openai/gpt-5", display_name: "GPT-5" }] } },
    );
    post.mockResolvedValue({ data: { model: { model_id: "moonshotai/kimi-k3", context_window: 256000 } } });
    const onChange = vi.fn();
    montarCom(onChange);

    fireEvent.change(await screen.findByPlaceholderText(/anthropic\/claude-sonnet-4.5/u), {
      target: { value: "kimi" },
    });
    fireEvent.click(await screen.findByText("MoonshotAI: Kimi K3"));

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith("moonshotai/kimi-k3", { contextWindow: 256000 }),
    );
    expect(post).toHaveBeenCalledWith("/api/v1/ai/providers/openrouter/models", {
      model_id: "moonshotai/kimi-k3",
    });
  });

  it("⭐ colar um código que a busca não achou oferece 'Usar o código'", async () => {
    get.mockResolvedValue({ data: { models: [] } });
    post.mockResolvedValue({ data: { model: { model_id: "lab/modelo-x", context_window: null } } });
    const onChange = vi.fn();
    montarCom(onChange);

    fireEvent.change(await screen.findByPlaceholderText(/anthropic\/claude-sonnet-4.5/u), {
      target: { value: "lab/modelo-x" },
    });
    fireEvent.click(await screen.findByText("Usar o código lab/modelo-x"));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("lab/modelo-x", { contextWindow: null }));
  });

  it("Anthropic não mostra a busca — não há origem para buscar", async () => {
    get.mockResolvedValue({ data: { models: [] } });
    montarCom(vi.fn(), "anthropic");
    await screen.findByRole("combobox");
    expect(screen.queryByPlaceholderText(/anthropic\/claude-sonnet-4.5/u)).not.toBeInTheDocument();
  });
});
