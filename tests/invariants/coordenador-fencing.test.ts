import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";

import type { ChannelSendResult } from "@/lib/agent-engine/channel-adapter";
import { coordenacaoGate, runBeforeSend } from "@/lib/agent-engine/guardrails/before-send";
import type { Logger } from "@/lib/agent-engine/obs/logger";
import { transicionar } from "@/lib/coordenador/estado";

/**
 * Fencing do envio (migration 0229 + gate `coordenacao`, cadeia v7).
 *
 * O turno recebe do coordenador uma GERAÇÃO. Entre a decisão e o envio, uma
 * pessoa pode assumir a conversa (por qualquer caminho: a trigger de prioridade
 * humana sobe a geração) — e a resposta que o agente estava escrevendo não pode
 * sair. A conferência roda SOB o advisory lock do envio, no banco real, colada
 * ao `send`.
 *
 * A cadeia é reduzida ao gate de coordenação (`gates`): pacing, janela e
 * conteúdo têm testes próprios, e aqui o que se prova é só quem pode falar.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 4,
});

const ORG = "0229f000-0000-4000-8000-000000000001";
const SESSAO = "0229f000-2222-4000-8000-000000000001";
const CONTATO = "0229f000-3333-4000-8000-000000000001";
const CONV = "0229f000-4444-4000-8000-000000000001";
const CONTATO_LEGADO = "0229f000-3333-4000-8000-000000000002";
const CONV_LEGADO = "0229f000-4444-4000-8000-000000000002";
const AGENTE = "0229f000-5555-4000-8000-000000000001";
const OUTRO_AGENTE = "0229f000-5555-4000-8000-000000000002";

const log: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as Logger;

function enviar(conversa: string, contato: string, geracao: number | null, executor = AGENTE) {
  const send = vi.fn(async (): Promise<ChannelSendResult> => ({
    kind: "sent",
    idempotencyKey: "k",
    messageId: "m",
  }));
  const run = runBeforeSend({
    pool,
    log,
    tenantId: ORG,
    leadId: contato,
    channelSessionId: SESSAO,
    body: "Temos dois planos: mensal e anual.",
    optedOutThisTurn: false,
    crmDailyLimit: null,
    now: new Date(),
    gates: [coordenacaoGate],
    ...(geracao !== null
      ? { coordenacao: { conversationId: conversa, executorTipo: "agente" as const, executorId: executor, geracao } }
      : {}),
    send,
  });
  return { run, send };
}

beforeAll(async () => {
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1, 'coord-fencing', 'Coord Fencing', 'Coord Fencing')`,
    [ORG],
  );
  await pool.query(
    `insert into channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
     values ($1, $2, 'coord-fencing', '\\x00'::bytea)`,
    [SESSAO, ORG],
  );
  await pool.query(
    `insert into contacts (id, organization_id, display_name) values ($1, $3, 'Cliente sintético'), ($2, $3, 'Cliente legado')`,
    [CONTATO, CONTATO_LEGADO, ORG],
  );
  await pool.query(
    `insert into conversations (id, organization_id, contact_id, channel_session_id, status)
     values ($1, $3, $2, $5, 'open'), ($4, $3, $6, $5, 'open')`,
    [CONV, CONTATO, ORG, CONV_LEGADO, SESSAO, CONTATO_LEGADO],
  );
  await pool.query(
    `insert into ai_agents (id, organization_id, name, system_prompt)
     values ($1, $3, 'Comercial', 'prompt'), ($2, $3, 'Suporte', 'prompt')`,
    [AGENTE, OUTRO_AGENTE, ORG],
  );
  const r = await transicionar(pool, {
    organizationId: ORG,
    conversationId: CONV,
    versaoEsperada: 0,
    para: { tipo: "agente", agentId: AGENTE, agentVersionId: null },
    categoria: "regra",
    motivo: "primeira_mensagem_regra",
  });
  expect(r).toMatchObject({ ok: true, geracao: 1 });
});

afterAll(async () => {
  await pool.end();
});

describe("0229 · fencing do envio (gate coordenacao)", () => {
  it("dono na geração recebida: envia", async () => {
    const { run, send } = enviar(CONV, CONTATO, 1);
    expect((await run).status).toBe("sent");
    expect(send).toHaveBeenCalledOnce();
  });

  it("outro agente com a mesma geração: não envia", async () => {
    const { run, send } = enviar(CONV, CONTATO, 1, OUTRO_AGENTE);
    expect(await run).toMatchObject({ status: "vetoed", code: "coordenador_outro_responsavel" });
    expect(send).not.toHaveBeenCalled();
  });

  it("caminho legado (sem concessão) não é afetado pelo coordenador", async () => {
    const { run, send } = enviar(CONV_LEGADO, CONTATO_LEGADO, null);
    expect((await run).status).toBe("sent");
    expect(send).toHaveBeenCalledOnce();
  });

  it("a equipe assumiu entre a decisão e o envio: a resposta do agente não sai", async () => {
    await pool.query(`update conversations set bot_silenced_until = 'infinity' where id = $1`, [CONV]);
    const { run, send } = enviar(CONV, CONTATO, 1);
    const r = await run;
    expect(r).toMatchObject({ status: "vetoed", code: "coordenador_outro_responsavel" });
    expect(r.status === "vetoed" ? r.message : "").toContain("pessoa_no_comando");
    expect(send).not.toHaveBeenCalled();
  });
});
