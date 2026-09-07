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
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { estadoDoPicker, ModelPicker } from "./ModelPicker";

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
