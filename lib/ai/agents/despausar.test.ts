/**
 * O defeito: pausar um mcp_agent tirava a versão do ar e não havia volta pela
 * tela — o "Despausar" ficava desabilitado e o editor só publica rascunho.
 * Despausar agora republica a versão que a pausa retirou.
 */
import { describe, it, expect } from "vitest";

import { bancoEmMemoria } from "@/tests/helpers/banco-em-memoria";

import { despausarAgente } from "./despausar";

const ORG = "org-1";
const AGENTE = "agent-1";

function versao(over: Record<string, unknown>) {
  return {
    organization_id: ORG,
    agent_id: AGENTE,
    status: "superseded",
    provider: "anthropic",
    credential_id: "cred-1",
    published_at: "2026-10-01T00:00:00Z",
    superseded_at: "2026-10-02T00:00:00Z",
    ...over,
  };
}

function bancoCom(versoes: Array<Record<string, unknown>>) {
  const banco = bancoEmMemoria({ ai_agent_versions: versoes });
  banco.respostasDeRpc.fn_publish_ai_agent_version = (args) => ({
    data: [
      {
        agent_id: args.p_agent_id,
        version_id: args.p_version_id,
        previous_version_id: null,
        published_at: "2026-10-31T00:00:00Z",
      },
    ],
    error: null,
  });
  return banco;
}

describe("despausarAgente", () => {
  it("republica a versão que a pausa retirou — a superseded mais recente", async () => {
    const banco = bancoCom([
      versao({ id: "v6", superseded_at: "2026-10-20T15:41:26Z" }),
      versao({ id: "v7", published_at: "2026-10-20T15:41:26Z", superseded_at: "2026-10-30T18:05:47Z" }),
      versao({ id: "v5", superseded_at: "2026-10-15T13:28:33Z" }),
    ]);

    const r = await despausarAgente(banco.client, { orgId: ORG, agentId: AGENTE });

    expect(r).toMatchObject({ ok: true, version_id: "v7" });
    expect(banco.rpcs).toEqual([
      {
        nome: "fn_publish_ai_agent_version",
        args: { p_org_id: ORG, p_agent_id: AGENTE, p_version_id: "v7" },
      },
    ]);
  });

  it("não publica rascunho nem versão de outro agente ou de outra organização", async () => {
    const banco = bancoCom([
      versao({ id: "rascunho", status: "draft", published_at: null, superseded_at: null }),
      versao({ id: "de-outro-agente", agent_id: "agent-2", superseded_at: "2026-10-31T00:00:00Z" }),
      versao({ id: "de-outra-org", organization_id: "org-2", superseded_at: "2026-10-31T00:00:00Z" }),
      versao({ id: "a-certa", superseded_at: "2026-10-30T00:00:00Z" }),
    ]);

    const r = await despausarAgente(banco.client, { orgId: ORG, agentId: AGENTE });

    expect(r).toMatchObject({ ok: true, version_id: "a-certa" });
  });

  it("agente que nunca esteve no ar não é despausado — volta código, não publica nada", async () => {
    const banco = bancoCom([
      versao({ id: "rascunho", status: "draft", published_at: null, superseded_at: null }),
    ]);

    const r = await despausarAgente(banco.client, { orgId: ORG, agentId: AGENTE });

    expect(r).toEqual({ ok: false, code: "nada_para_despausar", message: "nada_para_despausar" });
    expect(banco.rpcs).toEqual([]);
  });

  it("recusa da função SQL chega com o código estável (ex.: WhatsApp desconectado)", async () => {
    const banco = bancoCom([versao({ id: "v7" })]);
    banco.respostasDeRpc.fn_publish_ai_agent_version = () => ({
      data: null,
      error: { message: "channel_session_offline" },
    });

    const r = await despausarAgente(banco.client, { orgId: ORG, agentId: AGENTE });

    expect(r).toMatchObject({ ok: false, code: "channel_session_offline" });
  });
});
