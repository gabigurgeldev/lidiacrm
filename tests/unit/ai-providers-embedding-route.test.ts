/**
 * PUT /api/v1/ai/providers/embedding — a troca do modelo do material.
 *
 *  - prova reprovada ⇒ NADA é gravado (um modelo que não entrega 1536 deixaria
 *    todo o material sem indexar, ao mesmo tempo);
 *  - os DOIS pontos (indexar e buscar) são gravados na mesma escrita;
 *  - só pede reindexação quando o MAPA muda (trocar de chave não reindexa);
 *  - quem não é admin não troca.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const upsert = vi.fn();
const prova = vi.fn();
const pedir = vi.fn();
const situacao = vi.fn();
const audit = vi.fn();
const anterior = vi.hoisted(() => ({ binding: null as null | { provider: string; model_id: string } }));

vi.mock("@/lib/env", () => ({ env: {} }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: (...a: unknown[]) => audit(...a) }));
vi.mock("@/lib/ai/embeddings/prova", () => ({ provarModeloDeEmbedding: (...a: unknown[]) => prova(...a) }));
vi.mock("@/lib/ai/embeddings/reindexacao", () => ({
  pedirReindexacao: (...a: unknown[]) => pedir(...a),
  situacaoDoAcervo: (...a: unknown[]) => situacao(...a),
}));
vi.mock("@/lib/ai/embeddings/chave", () => ({ resolverChaveDeEmbedding: vi.fn(), EXPLICACAO_DA_ORIGEM: {} }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const q = {
        upsert: (linhas: unknown) => {
          upsert(linhas);
          return { select: async () => ({ data: (linhas as unknown[]).map((_, i) => ({ id: `b${i}` })), error: null }) };
        },
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: { id: "cred", provider: "openrouter" } }),
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: anterior.binding }) };
      return q;
    },
  }),
}));

import { requireRole } from "@/lib/auth/require-role";

import { PUT } from "@/app/api/v1/ai/providers/embedding/route";

const chamar = (corpo: unknown) =>
  PUT(
    new NextRequest("http://x/api/v1/ai/providers/embedding", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
    }),
  );

beforeEach(() => {
  for (const f of [upsert, prova, pedir, situacao, audit]) f.mockReset();
  anterior.binding = null;
  vi.mocked(requireRole).mockResolvedValue({ ok: true, org: { orgId: "org-1", role: "admin" }, user: { id: "u" } } as never);
  prova.mockResolvedValue({ ok: true });
  situacao.mockResolvedValue({ foraDoAlvo: [{ id: "f1" }, { id: "f2" }], custoEstimadoCentavos: 3 });
  pedir.mockResolvedValue(2);
});

describe("PUT embedding", () => {
  it("prova reprovada não grava nada", async () => {
    prova.mockResolvedValue({ ok: false, codigo: "embedding_dimensao_incompativel", mensagem: "não deu 1536", status: 422 });
    const res = await chamar({ provider: "openrouter", model_id: "google/gemini-embedding-001" });
    expect(res.status).toBe(422);
    expect(upsert).not.toHaveBeenCalled();
    expect(pedir).not.toHaveBeenCalled();
  });

  it("grava os DOIS pontos juntos e pede reindexação quando o mapa muda", async () => {
    const res = await chamar({ provider: "openrouter", model_id: "google/gemini-embedding-001" });
    expect(res.status).toBe(200);
    const linhas = upsert.mock.calls[0]![0] as Array<{ purpose: string; provider: string; model_id: string }>;
    expect(linhas.map((l) => l.purpose).sort()).toEqual(["embedding_consultar", "embedding_indexar"]);
    expect(new Set(linhas.map((l) => `${l.provider}|${l.model_id}`)).size).toBe(1);
    expect(pedir).toHaveBeenCalledWith(expect.anything(), "org-1", [{ id: "f1" }, { id: "f2" }], "google/gemini-embedding-001@1536", "troca_no_painel");
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ai.embedding_model_changed",
        metadata: expect.objectContaining({ de: "openai/text-embedding-3-small", para: "google/gemini-embedding-001@1536" }),
      }),
    );
  });

  it("mesmo mapa por outro provedor (só troca a chave) não reindexa", async () => {
    anterior.binding = { provider: "openai", model_id: "text-embedding-3-small" };
    const corpo = await (await chamar({ provider: "openrouter", model_id: "openai/text-embedding-3-small" })).json();
    expect(corpo.data.mudou_de_modelo).toBe(false);
    expect(pedir).not.toHaveBeenCalled();
  });

  it("id que não é de embedding é recusado antes da prova", async () => {
    const res = await chamar({ provider: "openai", model_id: "gpt-5-mini" });
    expect(res.status).toBe(422);
    expect(prova).not.toHaveBeenCalled();
  });

  it("quem não é admin não troca", async () => {
    vi.mocked(requireRole).mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) } as never);
    expect((await chamar({ provider: "openai", model_id: "text-embedding-3-large" })).status).toBe(403);
    expect(upsert).not.toHaveBeenCalled();
  });
});
