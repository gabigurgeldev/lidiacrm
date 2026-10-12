/**
 * A escada de `resolverChaveDeEmbedding` com a OpenRouter.
 *
 * O caso que este arquivo nasceu para guardar: uma organização cuja ÚNICA chave
 * é a da OpenRouter. O degrau 2 procurava só `provider='openai'`, e o material
 * dela ficava "sem credencial" para sempre — com a chave cadastrada e validada.
 *
 * O banco é falso de propósito: o que está sob teste é a ORDEM dos degraus e o
 * que cada um devolve, não o PostgREST.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const banco = vi.hoisted(() => ({
  credenciais: [] as Array<{ id: string; label: string; provider: string }>,
  binding: null as null | { provider: string; credential_id: string | null; model_id: string; base_url: string | null },
}));

vi.mock("@/lib/crypto/aes_gcm", () => ({
  byteaToBuffer: (v: unknown) => v,
  // A "chave decifrada" é o rótulo: basta para saber QUAL credencial venceu.
  decryptKey: ({ ciphertext }: { ciphertext: unknown }) => `chave:${String(ciphertext)}`,
}));

const envFalso = vi.hoisted(() => ({
  AI_GATEWAY_API_KEY: "",
  AI_GATEWAY_BASE_URL: "",
  OPENAI_API_KEY: "",
  OPENROUTER_API_KEY: "",
  OPENROUTER_BASE_URL: "",
}));
vi.mock("@/lib/env", () => ({ env: envFalso }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => {
      const filtros: Record<string, unknown> = {};
      const q = {
        select: () => q,
        eq: (col: string, val: unknown) => {
          filtros[col] = val;
          return q;
        },
        not: () => q,
        order: async () => ({
          data:
            tabela === "ai_provider_credentials"
              ? banco.credenciais
                  .filter((c) => c.provider === filtros.provider)
                  .map((c) => ({
                    id: c.id,
                    label: c.label,
                    api_key_encrypted: c.label,
                    api_key_iv: "",
                    api_key_tag: "",
                  }))
              : [],
        }),
        // O binding do painel (degrau 1) vem de `banco.binding`; credencial por id não é usada aqui.
        maybeSingle: async () => ({ data: tabela === "ai_purpose_bindings" ? banco.binding : null }),
      };
      return q;
    },
  }),
}));

import { resolverChaveDeEmbedding, resolverChaveParaMapa } from "@/lib/ai/embeddings/chave";

beforeEach(() => {
  banco.credenciais = [];
  banco.binding = null;
  envFalso.OPENAI_API_KEY = "";
  envFalso.OPENROUTER_API_KEY = "";
});

describe("resolverChaveDeEmbedding — OpenRouter", () => {
  it("organização só com a chave da OpenRouter indexa pela OpenRouter", async () => {
    banco.credenciais = [{ id: "c1", label: "Produção", provider: "openrouter" }];

    const chave = await resolverChaveDeEmbedding("org-1");

    expect(chave, "a chave da OpenRouter existe e foi ignorada").not.toBeNull();
    expect(chave?.provedor).toBe("openrouter");
    expect(chave?.origem).toBe("credencial_openrouter_da_organizacao");
    expect(chave?.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(chave?.apiKey).toBe("chave:Produção");
    expect(chave?.viaGateway).toBe(false);
  });

  it("com as duas cadastradas, a OpenAI continua vencendo — quem já indexava não muda", async () => {
    banco.credenciais = [
      { id: "c1", label: "Roteador", provider: "openrouter" },
      { id: "c2", label: "OpenAI", provider: "openai" },
    ];

    const chave = await resolverChaveDeEmbedding("org-1");

    expect(chave?.provedor).toBe("openai");
    expect(chave?.origem).toBe("credencial_da_organizacao");
    expect(chave?.baseUrl).toBeNull();
  });

  it("sem credencial na organização, a chave OpenRouter da instalação ainda serve", async () => {
    envFalso.OPENROUTER_API_KEY = "sk-or-instalacao";

    const chave = await resolverChaveDeEmbedding("org-1");

    expect(chave?.provedor).toBe("openrouter");
    expect(chave?.origem).toBe("chave_openrouter_da_instalacao");
    expect(chave?.baseUrl).toBe("https://openrouter.ai/api/v1");
  });

  it("a chave OpenAI da instalação vem antes da OpenRouter da instalação", async () => {
    envFalso.OPENAI_API_KEY = "sk-instalacao";
    envFalso.OPENROUTER_API_KEY = "sk-or-instalacao";

    const chave = await resolverChaveDeEmbedding("org-1");

    expect(chave?.origem).toBe("chave_da_instalacao");
    expect(chave?.provedor).toBe("openai");
  });

  it("sem nenhuma chave, a resposta é null — e não um palpite", async () => {
    expect(await resolverChaveDeEmbedding("org-1")).toBeNull();
  });
});

describe("resolverChaveDeEmbedding — modelo escolhido no painel", () => {
  it("sem escolha, a chave carrega o mapa LEGADO (quem atualiza não reindexa)", async () => {
    envFalso.OPENAI_API_KEY = "sk";
    const chave = await resolverChaveDeEmbedding("org-1");
    expect(chave?.modelo).toMatchObject({ mapa: "openai/text-embedding-3-small", idNoProvedor: "text-embedding-3-small", parametro: null });
  });

  it("Gemini pela OpenRouter usa a chave da OpenRouter, com o id e o corte certos", async () => {
    banco.binding = { provider: "openrouter", credential_id: null, model_id: "google/gemini-embedding-001", base_url: null };
    banco.credenciais = [{ id: "c1", label: "OR", provider: "openrouter" }];
    const chave = await resolverChaveDeEmbedding("org-1");
    expect(chave?.modelo).toMatchObject({ mapa: "google/gemini-embedding-001@1536", provedor: "openrouter", parametro: "dimensions" });
    expect(chave?.baseUrl).toBe("https://openrouter.ai/api/v1");
  });

  it("sem chave do provedor escolhido, usa outro que sirva o MESMO mapa — e avisa", async () => {
    banco.binding = { provider: "openrouter", credential_id: null, model_id: "openai/text-embedding-3-large", base_url: null };
    envFalso.OPENAI_API_KEY = "sk";
    const chave = await resolverChaveDeEmbedding("org-1");
    expect(chave?.modelo).toMatchObject({ mapa: "openai/text-embedding-3-large@1536", provedor: "openai", idNoProvedor: "text-embedding-3-large" });
    expect(chave?.avisos.join(" ")).toMatch(/mesmo modelo/);
  });

  it("nenhum provedor com chave para o mapa escolhido: null — nunca outro mapa", async () => {
    banco.binding = { provider: "google", credential_id: null, model_id: "gemini-embedding-001", base_url: null };
    envFalso.OPENAI_API_KEY = "sk";
    expect(await resolverChaveDeEmbedding("org-1")).toBeNull();
  });

  it("a busca acha material ANTIGO pelo mapa dele, mesmo depois da troca", async () => {
    banco.binding = { provider: "openrouter", credential_id: null, model_id: "google/gemini-embedding-001", base_url: null };
    banco.credenciais = [{ id: "c1", label: "OR", provider: "openrouter" }];
    envFalso.OPENAI_API_KEY = "sk";
    const legado = await resolverChaveParaMapa("org-1", "openai/text-embedding-3-small");
    expect(legado?.modelo.mapa).toBe("openai/text-embedding-3-small");
    const novo = await resolverChaveParaMapa("org-1", "google/gemini-embedding-001@1536");
    expect(novo?.modelo.mapa).toBe("google/gemini-embedding-001@1536");
  });
});
