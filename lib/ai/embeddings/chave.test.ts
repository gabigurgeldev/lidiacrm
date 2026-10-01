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

const banco = vi.hoisted(() => ({ credenciais: [] as Array<{ id: string; label: string; provider: string }> }));

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
        // Nenhum binding no painel: a escada começa no degrau 2.
        maybeSingle: async () => ({ data: null }),
      };
      return q;
    },
  }),
}));

import { resolverChaveDeEmbedding } from "@/lib/ai/embeddings/chave";

beforeEach(() => {
  banco.credenciais = [];
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
