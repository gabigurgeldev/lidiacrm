import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { chamarFluxo } from "@/lib/coordenador/chamadas";
import { lerEstado, transicionar } from "@/lib/coordenador/estado";
import { executarPedido } from "@/lib/coordenador/ferramenta";
import { carregarPoliticaEfetiva } from "@/lib/coordenador/politica/resolver";

/**
 * O ciclo "agente chama um fluxo e volta" (migration 0230), no banco que o
 * clone recebe.
 *
 *   - chamar: fencing (só o dono, na geração dele), execução no gatilho da
 *     versão ativa, chamada registrada, conversa entregue — tudo junto;
 *   - a mesma intenção repetida devolve a chamada original (retry da tool);
 *   - o fluxo termina: a chamada fecha com a SAÍDA, a conversa volta ao agente
 *     e o turno dele nasce no outbox com a marca da chamada;
 *   - uma pessoa assumiu no meio: o retorno atrasado não a toma de volta;
 *   - transferência definitiva não volta;
 *   - a ferramenta do agente só aceita destino que a política permite.
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

const ORG = "0230c000-0000-4000-8000-000000000001";
const SESSAO = "0230c000-2222-4000-8000-000000000001";
const COMERCIAL = "0230c000-5555-4000-8000-000000000001";
const SUPORTE = "0230c000-5555-4000-8000-000000000002";
const V_COMERCIAL = "0230c000-5555-4000-8000-0000000000a1";
const V_SUPORTE = "0230c000-5555-4000-8000-0000000000a2";
const FLUXO = "0230c000-7777-4000-8000-000000000001";
const V_FLUXO = "0230c000-7777-4000-8000-0000000000a1";

let seq = 0;
function id(prefixo: string): string {
  seq += 1;
  return `0230c000-${prefixo}-4000-8000-${String(seq).padStart(12, "0")}`;
}

interface Conversa {
  conversationId: string;
  contactId: string;
  geracao: number;
}

/** Conversa nova, com uma mensagem do cliente, conduzida pelo agente comercial. */
async function conversaComOComercial(): Promise<Conversa> {
  const contato = id("3333");
  const conv = id("4444");
  await pool.query(`insert into contacts (id, organization_id, display_name) values ($1, $2, 'Cliente sintético')`, [
    contato,
    ORG,
  ]);
  await pool.query(
    `insert into conversations (id, organization_id, contact_id, channel_session_id, status)
     values ($1, $2, $3, $4, 'open')`,
    [conv, ORG, contato, SESSAO],
  );
  await pool.query(
    `insert into messages (id, organization_id, conversation_id, channel_session_id, contact_id, type, direction, body)
     values ($1, $2, $3, $4, $5, 'text', 'inbound', 'quero fazer meu cadastro')`,
    [id("6666"), ORG, conv, SESSAO, contato],
  );
  const r = await transicionar(pool, {
    organizationId: ORG,
    conversationId: conv,
    versaoEsperada: 0,
    para: { tipo: "agente", agentId: COMERCIAL, agentVersionId: V_COMERCIAL },
    categoria: "regra",
    motivo: "primeira_mensagem_regra",
  });
  if (!r.ok) throw new Error(`seed: ${r.motivo}`);
  return { conversationId: conv, contactId: contato, geracao: r.geracao };
}

function chamar(c: Conversa, modalidade: "retorno" | "definitiva", chave: string, geracao = c.geracao, agente = COMERCIAL) {
  return chamarFluxo(pool, {
    organizationId: ORG,
    conversationId: c.conversationId,
    origemAgentId: agente,
    origemAgentVersionId: null,
    geracaoOrigem: geracao,
    flowId: FLUXO,
    modalidade,
    input: { objetivo: "cadastrar" },
    objetivo: "cadastrar o cliente",
    chaveIdempotencia: chave,
    prazoHoras: 24,
    politicaVersaoId: null,
  });
}

async function concluirExecucao(executionId: string, output: Record<string, unknown>): Promise<void> {
  await pool.query(
    `update flow_executions
        set status = 'completed', outcome = 'ok', output = $2::jsonb, next_eval_at = null, completed_at = now()
      where id = $1`,
    [executionId, JSON.stringify(output)],
  );
}

beforeAll(async () => {
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name) values ($1, 'coord-chamadas', 'Coord Chamadas', 'Coord Chamadas')`,
    [ORG],
  );
  await pool.query(
    `insert into channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
     values ($1, $2, 'coord-chamadas', '\\x00'::bytea)`,
    [SESSAO, ORG],
  );
  for (const [agente, versao, nome] of [
    [COMERCIAL, V_COMERCIAL, "Comercial"],
    [SUPORTE, V_SUPORTE, "Suporte"],
  ] as const) {
    await pool.query(`insert into ai_agents (id, organization_id, name, system_prompt) values ($1, $2, $3, 'prompt')`, [
      agente,
      ORG,
      nome,
    ]);
    await pool.query(
      `insert into ai_agent_versions
         (id, organization_id, agent_id, version_number, system_prompt, provider, model, channel_session_id, status)
       values ($1, $2, $3, 1, 'prompt', 'openrouter', 'dublê/modelo', $4, 'published')`,
      [versao, ORG, agente, SESSAO],
    );
    await pool.query(`update ai_agents set published_version_id = $2 where id = $1`, [agente, versao]);
  }
  await pool.query(`insert into flows (id, organization_id, name, status) values ($1, $2, 'Cadastro', 'draft')`, [
    FLUXO,
    ORG,
  ]);
  await pool.query(
    `insert into flow_versions (id, organization_id, flow_id, version_number, graph, trigger_config)
     values ($1, $2, $3, 1, $4::jsonb, '{"kind":"manual"}'::jsonb)`,
    [
      V_FLUXO,
      ORG,
      FLUXO,
      JSON.stringify({
        nodes: [
          { id: "inicio", type: "trigger.manual", config: {} },
          { id: "fim", type: "logic.end", config: {} },
        ],
        edges: [{ id: "e1", source: "inicio", target: "fim" }],
      }),
    ],
  );
  await pool.query(`update flows set status = 'active', active_version_id = $2 where id = $1`, [FLUXO, V_FLUXO]);
  await pool.query(`select public.fn_coord_publicar_politica($1, null, 'active', $2::jsonb, $3::jsonb, null)`, [
    ORG,
    JSON.stringify({
      destino_padrao: "comercial",
      permissoes: { comercial: { pode_chamar: ["cadastro"], pode_transferir: ["suporte"] } },
    }),
    JSON.stringify([
      { chave: "comercial", tipo: "agente", agent_id: COMERCIAL, quando_usar: "Vendas" },
      { chave: "suporte", tipo: "agente", agent_id: SUPORTE, quando_usar: "Problemas" },
      { chave: "cadastro", tipo: "fluxo", flow_id: FLUXO, quando_usar: "Cadastrar cliente" },
    ]),
  ]);
});

afterAll(async () => {
  await pool.end();
});

describe("0230 · chamada agente → fluxo e retorno", () => {
  it("chamar: a execução nasce no gatilho, a chamada fica ativa e a conversa passa ao fluxo", async () => {
    const c = await conversaComOComercial();
    const r = await chamar(c, "retorno", `t1-${c.conversationId}`);
    expect(r).toMatchObject({ ok: true, jaExistia: false });
    if (!r.ok) return;
    const estado = await lerEstado(pool, ORG, c.conversationId);
    expect(estado).toMatchObject({ dono_tipo: "fluxo", dono_execution_id: r.executionId, geracao: c.geracao + 1 });
    const { rows } = await pool.query<{ current_node_id: string; status: string; chamada: string }>(
      `select x.current_node_id, x.status, ch.status as chamada
         from flow_executions x join coord_chamadas ch on ch.destino_execution_id = x.id
        where x.id = $1`,
      [r.executionId],
    );
    expect(rows[0]).toEqual({ current_node_id: "inicio", status: "pending", chamada: "ativa" });
  });

  it("a mesma intenção repetida devolve a chamada original — uma execução só", async () => {
    const c = await conversaComOComercial();
    const a = await chamar(c, "retorno", `t2-${c.conversationId}`);
    const b = await chamar(c, "retorno", `t2-${c.conversationId}`);
    expect(b).toMatchObject({ ok: true, jaExistia: true });
    expect(a.ok && b.ok && a.chamadaId === b.chamadaId).toBe(true);
    const { rows } = await pool.query<{ n: string }>(
      `select count(*)::text n from flow_executions where conversation_id = $1`,
      [c.conversationId],
    );
    expect(rows[0]?.n).toBe("1");
  });

  it("fencing: geração velha ou agente que não é o dono não chamam — e nada é criado", async () => {
    const c = await conversaComOComercial();
    expect(await chamar(c, "retorno", `t3a-${c.conversationId}`, c.geracao - 1)).toEqual({
      ok: false,
      motivo: "geracao_obsoleta",
    });
    expect(await chamar(c, "retorno", `t3b-${c.conversationId}`, c.geracao, SUPORTE)).toEqual({
      ok: false,
      motivo: "nao_e_o_dono",
    });
    const { rows } = await pool.query<{ n: string }>(
      `select count(*)::text n from flow_executions where conversation_id = $1`,
      [c.conversationId],
    );
    expect(rows[0]?.n).toBe("0");
  });

  it("o fluxo termina: a chamada fecha com a saída e a conversa volta ao agente, com o turno dele no outbox", async () => {
    const c = await conversaComOComercial();
    const r = await chamar(c, "retorno", `t4-${c.conversationId}`);
    if (!r.ok) throw new Error(r.motivo);
    await concluirExecucao(r.executionId!, { cpf_validado: true });

    const { rows: ch } = await pool.query<{ status: string; output: Record<string, unknown> }>(
      `select status, output from coord_chamadas where id = $1`,
      [r.chamadaId],
    );
    expect(ch[0]).toEqual({ status: "concluida", output: { cpf_validado: true } });

    const estado = await lerEstado(pool, ORG, c.conversationId);
    expect(estado).toMatchObject({ dono_tipo: "agente", dono_agent_id: COMERCIAL, geracao: c.geracao + 2 });

    const { rows: ev } = await pool.query<{ payload: Record<string, unknown> }>(
      `select payload from event_log
        where organization_id = $1 and event_type = 'ai_agent.dispatch_requested'
          and payload->>'coord_chamada_id' = $2`,
      [ORG, r.chamadaId],
    );
    expect(ev).toHaveLength(1);
    expect(ev[0]!.payload).toMatchObject({
      conversation_id: c.conversationId,
      contact_id: c.contactId,
      imediato: true,
      coord_geracao: c.geracao + 2,
    });

    const { rows: tr } = await pool.query<{ categoria: string; motivo: string }>(
      `select categoria, motivo from coord_transicoes
        where conversation_id = $1 and status = 'aplicada' order by created_at desc limit 1`,
      [c.conversationId],
    );
    expect(tr[0]).toEqual({ categoria: "retorno", motivo: "retorno_da_chamada" });
  });

  it("uma pessoa assumiu no meio: o retorno atrasado NÃO toma a conversa de volta", async () => {
    const c = await conversaComOComercial();
    const r = await chamar(c, "retorno", `t5-${c.conversationId}`);
    if (!r.ok) throw new Error(r.motivo);
    await pool.query(`update conversations set bot_silenced_until = 'infinity' where id = $1`, [c.conversationId]);
    await concluirExecucao(r.executionId!, {});

    expect((await lerEstado(pool, ORG, c.conversationId))?.dono_tipo).toBe("pessoa");
    const { rows } = await pool.query<{ n: string }>(
      `select count(*)::text n from event_log where payload->>'coord_chamada_id' = $1`,
      [r.chamadaId],
    );
    expect(rows[0]?.n).toBe("0");
  });

  it("transferência definitiva: o fluxo termina e a conversa não volta ao agente", async () => {
    const c = await conversaComOComercial();
    const r = await chamar(c, "definitiva", `t6-${c.conversationId}`);
    if (!r.ok) throw new Error(r.motivo);
    await concluirExecucao(r.executionId!, {});
    expect(await lerEstado(pool, ORG, c.conversationId)).toMatchObject({
      dono_tipo: "fluxo",
      dono_execution_id: r.executionId,
    });
  });

  it("ferramenta do agente: destino fora da permissão é recusado; transferência permitida despacha o novo agente", async () => {
    const politica = await carregarPoliticaEfetiva(pool, ORG, SESSAO);
    if (!politica) throw new Error("política não carregada");
    const c = await conversaComOComercial();
    const concessao = {
      organizationId: ORG,
      conversationId: c.conversationId,
      agentId: COMERCIAL,
      agentVersionId: V_COMERCIAL,
      geracao: c.geracao,
      jobId: id("9999"),
    };

    expect(await executarPedido(pool, politica, concessao, { acao: "chamar_fluxo", destino: "suporte" })).toMatchObject({
      ok: false,
      motivo: "destino_nao_permitido",
    });

    const r = await executarPedido(pool, politica, concessao, { acao: "transferir", destino: "suporte" });
    expect(r).toMatchObject({ ok: true, status: "aceito" });
    expect(await lerEstado(pool, ORG, c.conversationId)).toMatchObject({ dono_tipo: "agente", dono_agent_id: SUPORTE });
    const { rows } = await pool.query<{ n: string }>(
      `select count(*)::text n from event_log
        where event_type = 'ai_agent.dispatch_requested' and payload->>'conversation_id' = $1`,
      [c.conversationId],
    );
    expect(rows[0]?.n).toBe("1");
  });
});
