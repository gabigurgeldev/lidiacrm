/**
 * Modo "só sugere respostas" (migration 0255) — quem decide para onde a versão
 * vai é `publishAgentVersion`, e o modo só existe para o agente com versões.
 *
 * O que estes casos prendem é a ROTA da publicação: agente comum segue pela
 * `fn_publish_ai_agent_version` de sempre (intocada); qualquer coisa que
 * envolva o modo — entrar, sair, ou publicar com ele ligado — passa pela
 * `fn_publicar_versao_do_agente`, que publica e retira na mesma transação. A
 * função SQL em si é exercitada contra Postgres pelo `pnpm test:db`.
 */
import { describe, it, expect } from "vitest";

import { bancoEmMemoria } from "@/tests/helpers/banco-em-memoria";

import { despausarAgente } from "./despausar";
import { ligarSoSugestao } from "./modo";
import { publishAgentVersion } from "./publish";

const ORG = "org-1";
const AGENTE = "agent-1";

function agente(over: Record<string, unknown> = {}) {
  return {
    id: AGENTE,
    organization_id: ORG,
    kind: "mcp_agent",
    published_version_id: null,
    archived_at: null,
    so_sugestao: false,
    ...over,
  };
}

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

function bancoCom(agentes: Array<Record<string, unknown>>, versoes: Array<Record<string, unknown>>) {
  const banco = bancoEmMemoria({ ai_agents: agentes, ai_agent_versions: versoes });
  const resposta = (args: Record<string, unknown>) => ({
    data: [
      {
        agent_id: args.p_agent_id,
        version_id: args.p_version_id,
        previous_version_id: null,
        published_at: "2026-11-20T00:00:00Z",
      },
    ],
    error: null,
  });
  banco.respostasDeRpc.fn_publish_ai_agent_version = resposta;
  banco.respostasDeRpc.fn_publicar_versao_do_agente = resposta;
  return banco;
}

describe("ligarSoSugestao", () => {
  it("agente atendendo: a versão NO AR passa a só sugerir — sem publicar outra", async () => {
    const banco = bancoCom([agente({ published_version_id: "v9" })], [versao({ id: "v9", status: "published" })]);

    const r = await ligarSoSugestao(banco.client, { orgId: ORG, agentId: AGENTE });

    expect(r).toMatchObject({ ok: true, version_id: "v9", so_sugestao: true });
    expect(banco.rpcs).toEqual([
      {
        nome: "fn_publicar_versao_do_agente",
        args: { p_org_id: ORG, p_agent_id: AGENTE, p_version_id: "v9", p_so_sugestao: true },
      },
    ]);
  });

  it("agente pausado: usa a última versão que esteve no ar (a mesma que despausar devolveria)", async () => {
    const banco = bancoCom(
      [agente()],
      [
        versao({ id: "v6", superseded_at: "2026-10-20T15:41:26Z" }),
        versao({ id: "v7", superseded_at: "2026-10-30T18:05:47Z" }),
        // Rascunho nunca publicado não conta.
        versao({ id: "v8", status: "draft", published_at: null, superseded_at: null }),
      ],
    );

    const r = await ligarSoSugestao(banco.client, { orgId: ORG, agentId: AGENTE });

    expect(r).toMatchObject({ ok: true, version_id: "v7" });
    expect(banco.rpcs[0]).toMatchObject({ nome: "fn_publicar_versao_do_agente", args: { p_version_id: "v7", p_so_sugestao: true } });
  });

  it("agente que nunca esteve no ar: recusa com motivo, sem chamar o banco", async () => {
    const banco = bancoCom([agente()], [versao({ id: "v1", status: "draft", published_at: null, superseded_at: null })]);

    const r = await ligarSoSugestao(banco.client, { orgId: ORG, agentId: AGENTE });

    expect(r).toMatchObject({ ok: false, code: "nada_para_sugerir" });
    expect(banco.rpcs).toEqual([]);
  });

  it("rag_bot legado: o modo não existe para ele (não há versão para sugerir)", async () => {
    const banco = bancoCom([agente({ kind: "rag_bot", is_active: true })], []);

    const r = await ligarSoSugestao(banco.client, { orgId: ORG, agentId: AGENTE });

    expect(r).toMatchObject({ ok: false, code: "modo_indisponivel" });
    expect(banco.rpcs).toEqual([]);
  });

  it("agente de OUTRA organização não é encontrado", async () => {
    const banco = bancoCom([agente({ organization_id: "org-2", published_version_id: "v9" })], []);

    const r = await ligarSoSugestao(banco.client, { orgId: ORG, agentId: AGENTE });

    expect(r).toMatchObject({ ok: false, code: "not_found" });
    expect(banco.rpcs).toEqual([]);
  });

  it("arquivado: recusa", async () => {
    const banco = bancoCom([agente({ archived_at: "2026-11-01T00:00:00Z" })], []);
    expect(await ligarSoSugestao(banco.client, { orgId: ORG, agentId: AGENTE })).toMatchObject({
      ok: false,
      code: "agent_archived",
    });
  });
});

describe("publishAgentVersion respeita o modo", () => {
  it("agente comum: segue pela função de sempre, sem o parâmetro novo", async () => {
    const banco = bancoCom([agente()], [versao({ id: "v2", status: "draft", published_at: null })]);

    const r = await publishAgentVersion(banco.client, { orgId: ORG, agentId: AGENTE, versionId: "v2" });

    expect(r).toMatchObject({ ok: true, so_sugestao: false });
    expect(banco.rpcs).toEqual([
      { nome: "fn_publish_ai_agent_version", args: { p_org_id: ORG, p_agent_id: AGENTE, p_version_id: "v2" } },
    ]);
  });

  it("agente só sugerindo: publicar no editor MANTÉM o modo — corrigir texto não é voltar a atender", async () => {
    const banco = bancoCom([agente({ so_sugestao: true })], [versao({ id: "v2", status: "draft", published_at: null })]);

    const r = await publishAgentVersion(banco.client, { orgId: ORG, agentId: AGENTE, versionId: "v2" });

    expect(r).toMatchObject({ ok: true, so_sugestao: true });
    expect(banco.rpcs).toEqual([
      {
        nome: "fn_publicar_versao_do_agente",
        args: { p_org_id: ORG, p_agent_id: AGENTE, p_version_id: "v2", p_so_sugestao: true },
      },
    ]);
  });

  it("despausar um agente que só sugeria volta a ATENDER — e sai do modo na mesma transação", async () => {
    const banco = bancoCom([agente({ so_sugestao: true })], [versao({ id: "v7" })]);

    const r = await despausarAgente(banco.client, { orgId: ORG, agentId: AGENTE });

    expect(r).toMatchObject({ ok: true, version_id: "v7", so_sugestao: false });
    expect(banco.rpcs).toEqual([
      {
        nome: "fn_publicar_versao_do_agente",
        args: { p_org_id: ORG, p_agent_id: AGENTE, p_version_id: "v7", p_so_sugestao: false },
      },
    ]);
  });

  it("erro do banco (ex.: número desconectado) chega como código, não como sucesso", async () => {
    const banco = bancoCom([agente({ so_sugestao: true })], [versao({ id: "v2", status: "draft", published_at: null })]);
    banco.respostasDeRpc.fn_publicar_versao_do_agente = () => ({
      data: null,
      error: { message: "channel_session_offline" },
    });

    const r = await publishAgentVersion(banco.client, { orgId: ORG, agentId: AGENTE, versionId: "v2" });

    expect(r).toMatchObject({ ok: false, code: "channel_session_offline" });
  });
});
