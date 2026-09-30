/**
 * A BUSCA AO VIVO no catálogo da OpenRouter — a regra pura e a memória curta.
 *
 * O defeito que ela resolve: modelo lançado hoje não aparecia no seletor até o
 * cron diário rodar, e não havia como digitar o código. A busca vai à origem;
 * o que precisa estar certo é a ORDEM (quem cola o código exato quer ele no
 * topo) e a memória (não ir à origem a cada tecla, sem guardar falha).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buscarNoCatalogo, type ModeloDaOpenRouter } from "@/lib/ai/catalogo/openrouter";
import {
  catalogoDaOrigem,
  esquecerCatalogoDaOrigem,
  VALIDADE_DO_CACHE_MS,
} from "@/lib/ai/catalogo/origem-em-cache";

const origem: ModeloDaOpenRouter[] = [
  { id: "anthropic/claude-sonnet-4.5:thinking", name: "Anthropic: Claude Sonnet 4.5 (thinking)" },
  { id: "openai/gpt-5", name: "OpenAI: GPT-5", supported_parameters: ["tools"] },
  { id: "anthropic/claude-sonnet-4.5", name: "Anthropic: Claude Sonnet 4.5", pricing: { prompt: "0.000003", completion: "0.000015" } },
  { id: "google/gemini-3-pro", name: "Google: Gemini 3 Pro" },
];

describe("buscarNoCatalogo", () => {
  it("⭐ código exato vem primeiro, mesmo depois de variantes na ordem da origem", () => {
    const r = buscarNoCatalogo(origem, "anthropic/claude-sonnet-4.5");
    expect(r.map((m) => m.model_id)).toEqual([
      "anthropic/claude-sonnet-4.5",
      "anthropic/claude-sonnet-4.5:thinking",
    ]);
  });

  it("⭐ traz preço traduzido — é o que o orçamento vai usar", () => {
    const [m] = buscarNoCatalogo(origem, "anthropic/claude-sonnet-4.5");
    expect(m?.input_price_per_million_cents).toBe(300);
    expect(m?.output_price_per_million_cents).toBe(1500);
  });

  it("casa por nome, sem diferenciar maiúscula", () => {
    expect(buscarNoCatalogo(origem, "GEMINI").map((m) => m.model_id)).toEqual(["google/gemini-3-pro"]);
  });

  it("prefixo antes de 'contém'", () => {
    const r = buscarNoCatalogo(origem, "openai");
    expect(r[0]?.model_id).toBe("openai/gpt-5");
  });

  it("termo vazio não devolve o catálogo inteiro", () => {
    expect(buscarNoCatalogo(origem, "   ")).toEqual([]);
  });

  it("respeita o limite", () => {
    expect(buscarNoCatalogo(origem, "a", 2)).toHaveLength(2);
  });

  it("nada casa → lista vazia", () => {
    expect(buscarNoCatalogo(origem, "modelo-que-nao-existe")).toEqual([]);
  });
});

describe("catalogoDaOrigem — memória curta", () => {
  beforeEach(() => esquecerCatalogoDaOrigem());

  it("⭐ dentro da validade não vai à origem de novo", async () => {
    const buscar = vi.fn(async () => origem);
    let t = 1_000;
    await catalogoDaOrigem(buscar, { agora: () => t });
    t += VALIDADE_DO_CACHE_MS - 1;
    await catalogoDaOrigem(buscar, { agora: () => t });
    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it("vencida, vai à origem de novo", async () => {
    const buscar = vi.fn(async () => origem);
    let t = 1_000;
    await catalogoDaOrigem(buscar, { agora: () => t });
    t += VALIDADE_DO_CACHE_MS + 1;
    await catalogoDaOrigem(buscar, { agora: () => t });
    expect(buscar).toHaveBeenCalledTimes(2);
  });

  it("⭐ `fresco` ignora a memória — o modelo lançado depois dela", async () => {
    const buscar = vi.fn(async () => origem);
    await catalogoDaOrigem(buscar);
    await catalogoDaOrigem(buscar, { fresco: true });
    expect(buscar).toHaveBeenCalledTimes(2);
  });

  it("⭐ falha NÃO é guardada — a próxima tentativa vai à origem", async () => {
    const buscar = vi
      .fn<() => Promise<ModeloDaOpenRouter[]>>()
      .mockRejectedValueOnce(new Error("catalogo_origem_status_503"))
      .mockResolvedValueOnce(origem);
    await expect(catalogoDaOrigem(buscar)).rejects.toThrow("503");
    await expect(catalogoDaOrigem(buscar)).resolves.toBe(origem);
  });

  it("duas buscas simultâneas viram uma ida à origem", async () => {
    const buscar = vi.fn(async () => origem);
    await Promise.all([catalogoDaOrigem(buscar), catalogoDaOrigem(buscar)]);
    expect(buscar).toHaveBeenCalledTimes(1);
  });
});
