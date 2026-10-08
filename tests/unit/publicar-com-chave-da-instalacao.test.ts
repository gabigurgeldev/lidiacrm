/**
 * "A CHAVE DESTA INSTALAÇÃO" PUBLICA — QUANDO HÁ CHAVE.
 *
 * A versão com `credential_id` nulo usa a chave do provedor que veio na
 * instalação (o `.env`), ou a credencial validada mais recente da organização —
 * a mesma ordem do motor (`lib/agent-engine/edge/llm/credentials.ts`). A função
 * SQL de publicar recusava nulo sempre; agora quem decide é esta checagem, que
 * roda antes dela em todo caminho que publica.
 *
 * Os dois lados importam: sem chave nenhuma, publicar seria pôr no ar um agente
 * que falha em toda mensagem. A função SQL é provada contra Postgres real em
 * `tests/invariants/publicar-com-chave-da-instalacao.test.ts`.
 */
import { describe, expect, it, vi } from "vitest";

import { publishAgentVersion, versaoSemCredencialTemChave } from "@/lib/ai/agents/publish";

/** Duplo do Supabase: credenciais validadas por provedor, versão e RPC. */
function admin(opts: {
  credenciaisValidadas?: string[];
  versao?: { provider: string; credential_id: string | null };
}) {
  const rpc = vi.fn(async () => ({
    data: [{ agent_id: "a", version_id: "v", previous_version_id: null, published_at: "2026-10-08T00:00:00Z" }],
    error: null,
  }));
  const from = (tabela: string) => {
    const filtros: Record<string, unknown> = {};
    const chain = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        filtros[col] = val;
        return chain;
      },
      not: () => chain,
      limit: async () => ({
        data:
          tabela === "ai_provider_credentials" &&
          (opts.credenciaisValidadas ?? []).includes(filtros.provider as string)
            ? [{ id: "c1" }]
            : [],
        error: null,
      }),
      maybeSingle: async () => ({ data: tabela === "ai_agent_versions" ? (opts.versao ?? null) : null, error: null }),
    };
    return chain;
  };
  return { cliente: { from, rpc } as never, rpc };
}

const SEM_CHAVE = {};
const COM_ANTHROPIC = { ANTHROPIC_API_KEY: "sk-ant-x" };

describe("versaoSemCredencialTemChave", () => {
  it("chave do provedor no .env da instalação: tem", async () => {
    expect(await versaoSemCredencialTemChave(admin({}).cliente, "org", "anthropic", COM_ANTHROPIC)).toBe(true);
  });

  it("credencial validada do provedor na organização: tem", async () => {
    const { cliente } = admin({ credenciaisValidadas: ["openai"] });
    expect(await versaoSemCredencialTemChave(cliente, "org", "openai", SEM_CHAVE)).toBe(true);
  });

  it("chave de OUTRO provedor não serve", async () => {
    const { cliente } = admin({ credenciaisValidadas: ["openai"] });
    expect(await versaoSemCredencialTemChave(cliente, "org", "anthropic", SEM_CHAVE)).toBe(false);
  });
});

describe("publishAgentVersion com credential_id nulo", () => {
  it("sem chave nenhuma: recusa com credential_missing ANTES de chamar a função SQL", async () => {
    const vazio = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const { cliente, rpc } = admin({ versao: { provider: "anthropic", credential_id: null } });
      const r = await publishAgentVersion(cliente, { orgId: "org", agentId: "a", versionId: "v" });
      expect(r).toMatchObject({ ok: false, code: "credential_missing" });
      expect(rpc).not.toHaveBeenCalled();
    } finally {
      if (vazio !== undefined) process.env.ANTHROPIC_API_KEY = vazio;
    }
  });

  it("com credencial validada do provedor: segue para a função SQL", async () => {
    const { cliente, rpc } = admin({
      versao: { provider: "openai", credential_id: null },
      credenciaisValidadas: ["openai"],
    });
    const r = await publishAgentVersion(cliente, { orgId: "org", agentId: "a", versionId: "v" });
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("credencial escolhida: não consulta a instalação, segue direto (a função SQL confere)", async () => {
    const { cliente, rpc } = admin({ versao: { provider: "anthropic", credential_id: "11111111-1111-4111-8111-111111111111" } });
    const r = await publishAgentVersion(cliente, { orgId: "org", agentId: "a", versionId: "v" });
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
