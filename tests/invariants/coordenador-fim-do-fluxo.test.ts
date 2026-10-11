import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { chamarFluxo } from "@/lib/coordenador/chamadas";
import type { Decisao, Decisor, PedidoDeDecisao } from "@/lib/coordenador/decisor/contrato";
import { coordenarTurnoDeEntrada } from "@/lib/coordenador/entrada";
import { lerEstado, transicionar } from "@/lib/coordenador/estado";
import { vigiarCoordenador } from "@/lib/coordenador/vigia";

/**
 * Quem fala quando um fluxo termina, e quem NÃO fala quando perdeu a conversa
 * (migration 0237), no banco que o clone recebe.
 *
 *   - fluxo dono termina e o cliente espera resposta: a conversa vai a
 *     `nenhum` e o turno é pedido UMA vez, na mesma transação;
 *   - fluxo dono termina tendo falado por último: só libera, sem turno;
 *   - fluxo que já pediu o turno (`crm.handoff_to_agent`): não pede de novo;
 *   - a trava do envio do fluxo cala só a execução que JÁ FOI dona e deixou
 *     de ser; fluxo que o coordenador nunca conduziu fala como antes;
 *   - o vigia libera dono-fluxo que terminou sem disparar o trigger (pausa);
 *   - o teto de consultas por hora conta em `llm_calls` — a consulta que
 *     terminava em "manter" não deixava rastro e o teto nunca batia;
 *   - cliente que volta depois de uma pausa longa: curta não fica com o dono
 *     antigo sem perguntar, e a troca não exige a confiança mínima.
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

const ORG = "0237c000-0000-4000-8000-000000000001";
const SESSAO = "0237c000-2222-4000-8000-000000000001";
const COMERCIAL = "0237c000-5555-4000-8000-000000000001";
const SUPORTE = "0237c000-5555-4000-8000-000000000002";
const V_COMERCIAL = "0237c000-5555-4000-8000-0000000000a1";
const V_SUPORTE = "0237c000-5555-4000-8000-0000000000a2";
const FLUXO = "0237c000-7777-4000-8000-000000000001";
const V_FLUXO = "0237c000-7777-4000-8000-0000000000a1";

let seq = 0;
function id(prefixo: string): string {
  seq += 1;
  return `0237c000-${prefixo}-4000-8000-${String(seq).padStart(12, "0")}`;
}

interface Conversa {
  conversationId: string;
  contactId: string;
  geracao: number;
}

class DecisorDuble implements Decisor {
  chamadas: PedidoDeDecisao[] = [];
  constructor(private resposta: Partial<Decisao>) {}
  async decidir(p: PedidoDeDecisao): Promise<Decisao> {
    this.chamadas.push(p);
    return {
      status: "ok",
      escolha: null,
      confianca: null,
      provedor: "dublê",
      modelo: "dublê/decisor",
      ms: 1,
      custoCents: null,
      ...this.resposta,
    };
  }
}

async function fala(
  c: Pick<Conversa, "conversationId" | "contactId">,
  direcao: "inbound" | "outbound",
  texto: string,
  haMinutos = 0,
): Promise<string> {
  const msg = id("6666");
  await pool.query(
    `insert into messages (id, organization_id, conversation_id, channel_session_id, contact_id, type, direction, body,
                           sent_at, created_at)
     values ($1, $2, $3, $4, $5, 'text', $6, $7, now() - make_interval(mins => $8), now() - make_interval(mins => $8))`,
    [msg, ORG, c.conversationId, SESSAO, c.contactId, direcao, texto, haMinutos],
  );
  return msg;
}

/** Conversa nova, conduzida pelo agente comercial (sem mensagem ainda). */
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

/** O agente transfere de vez para o fluxo: a execução vira a DONA da conversa. */
async function fluxoDono(c: Conversa): Promise<string> {
  const r = await chamarFluxo(pool, {
    organizationId: ORG,
    conversationId: c.conversationId,
    origemAgentId: COMERCIAL,
    origemAgentVersionId: null,
    geracaoOrigem: c.geracao,
    flowId: FLUXO,
    modalidade: "definitiva",
    input: {},
    objetivo: null,
    chaveIdempotencia: `def-${c.conversationId}`,
    prazoHoras: 24,
    politicaVersaoId: null,
  });
  if (!r.ok || !r.executionId) throw new Error(`seed fluxo: ${r.ok ? "sem execução" : r.motivo}`);
  return r.executionId;
}

async function terminar(executionId: string, status: "completed" | "dead" = "completed"): Promise<void> {
  await pool.query(
    `update flow_executions
        set status = $2, next_eval_at = null, completed_at = now()
      where id = $1`,
    [executionId, status],
  );
}

async function despachos(conversationId: string): Promise<Record<string, unknown>[]> {
  const { rows } = await pool.query<{ payload: Record<string, unknown> }>(
    `select payload from event_log
      where organization_id = $1 and event_type = 'ai_agent.dispatch_requested'
        and payload->>'conversation_id' = $2
      order by created_at`,
    [ORG, conversationId],
  );
  return rows.map((r) => r.payload);
}

async function podeFalar(conversationId: string, executionId: string): Promise<{ pode: boolean; motivo: string }> {
  const { rows } = await pool.query<{ r: { pode: boolean; motivo: string } }>(
    `select public.fn_coord_fluxo_pode_falar($1, $2, $3) as r`,
    [ORG, conversationId, executionId],
  );
  return rows[0]!.r;
}

beforeAll(async () => {
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name) values ($1, 'coord-fim-fluxo', 'Coord Fim', 'Coord Fim')`,
    [ORG],
  );
  await pool.query(
    `insert into channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
     values ($1, $2, 'coord-fim-fluxo', '\\x00'::bytea)`,
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
      permissoes: { comercial: { pode_transferir: ["cadastro", "suporte"] } },
      limites: { decisor_chamadas_por_hora: 3 },
    }),
    JSON.stringify([
      { chave: "comercial", tipo: "agente", agent_id: COMERCIAL, quando_usar: "Vendas" },
      { chave: "suporte", tipo: "agente", agent_id: SUPORTE, quando_usar: "Problemas e cancelamento" },
      { chave: "cadastro", tipo: "fluxo", flow_id: FLUXO, quando_usar: "Cadastrar cliente" },
    ]),
  ]);
});

afterAll(async () => {
  await pool.end();
});

describe("0237 · o fluxo dono termina", () => {
  it("cliente esperando resposta: a conversa vai a `nenhum` e o turno é pedido UMA vez", async () => {
    const c = await conversaComOComercial();
    const exec = await fluxoDono(c);
    await fala(c, "outbound", "Qual o seu e-mail?", 2);
    const resposta = await fala(c, "inbound", "ana@exemplo.com", 1);
    await terminar(exec);

    expect(await lerEstado(pool, ORG, c.conversationId)).toMatchObject({
      dono_tipo: "nenhum",
      situacao: "concluido",
      motivo: "fluxo_terminou",
    });
    const ev = await despachos(c.conversationId);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ inbound_message_id: resposta, imediato: true });
    expect(ev[0]).not.toHaveProperty("coord_chamada_id");

    const { rows } = await pool.query<{ categoria: string; motivo: string }>(
      `select categoria, motivo from coord_transicoes
        where conversation_id = $1 and status = 'aplicada' order by created_at desc limit 1`,
      [c.conversationId],
    );
    expect(rows[0]).toEqual({ categoria: "retorno", motivo: "fluxo_terminou" });
  });

  it("o fluxo falou por último: libera a conversa e NÃO pede turno", async () => {
    const c = await conversaComOComercial();
    const exec = await fluxoDono(c);
    await fala(c, "inbound", "quero me cadastrar", 3);
    await fala(c, "outbound", "Pronto, cadastro feito!", 1);
    await terminar(exec);

    expect((await lerEstado(pool, ORG, c.conversationId))?.dono_tipo).toBe("nenhum");
    expect(await despachos(c.conversationId)).toHaveLength(0);
  });

  it("execução morta (`dead`) também devolve a conversa", async () => {
    const c = await conversaComOComercial();
    const exec = await fluxoDono(c);
    await fala(c, "inbound", "oi?", 1);
    await terminar(exec, "dead");
    expect((await lerEstado(pool, ORG, c.conversationId))?.dono_tipo).toBe("nenhum");
    expect(await despachos(c.conversationId)).toHaveLength(1);
  });

  it("`crm.handoff_to_agent` já pediu o turno: o término não pede de novo", async () => {
    const c = await conversaComOComercial();
    const exec = await fluxoDono(c);
    const msg = await fala(c, "inbound", "quero falar com alguém", 1);
    await pool.query(
      `insert into event_log (organization_id, event_type, entity_kind, entity_id, payload, metadata)
       values ($1, 'ai_agent.dispatch_requested', 'message', $2, $3::jsonb, '{"source":"flow.handoff_to_agent"}'::jsonb)`,
      [ORG, msg, JSON.stringify({ conversation_id: c.conversationId, inbound_message_id: msg, entregue_por_fluxo: exec })],
    );
    await terminar(exec);

    expect((await lerEstado(pool, ORG, c.conversationId))?.dono_tipo).toBe("nenhum");
    expect(await despachos(c.conversationId)).toHaveLength(1);
  });

  it("vigia: dono-fluxo PAUSADO (sem trigger de término) volta à decisão pela mesma função", async () => {
    const c = await conversaComOComercial();
    const exec = await fluxoDono(c);
    await fala(c, "inbound", "e aí?", 1);
    await pool.query(`update flow_executions set status = 'paused', next_eval_at = null where id = $1`, [exec]);
    expect((await lerEstado(pool, ORG, c.conversationId))?.dono_tipo).toBe("fluxo");

    const r = await vigiarCoordenador(pool, async () => false);
    expect(r.liberadas).toBeGreaterThanOrEqual(1);
    expect((await lerEstado(pool, ORG, c.conversationId))?.dono_tipo).toBe("nenhum");
    expect(await despachos(c.conversationId)).toHaveLength(1);
  });
});

describe("0237 · a trava do envio do fluxo", () => {
  it("conversa que o coordenador nunca tocou: pode falar", async () => {
    const contato = id("3333");
    const conv = id("4444");
    await pool.query(`insert into contacts (id, organization_id, display_name) values ($1, $2, 'Sem coord')`, [contato, ORG]);
    await pool.query(
      `insert into conversations (id, organization_id, contact_id, channel_session_id, status) values ($1, $2, $3, $4, 'open')`,
      [conv, ORG, contato, SESSAO],
    );
    expect(await podeFalar(conv, id("8888"))).toEqual({ pode: true, motivo: "sem_coordenacao" });
  });

  it("a dona atual fala; perdeu a conversa (interrupção, pessoa) cala; fluxo nunca coordenado fala", async () => {
    const c = await conversaComOComercial();
    const exec = await fluxoDono(c);
    expect(await podeFalar(c.conversationId, exec)).toEqual({ pode: true, motivo: "dono_atual" });

    // Uma automação de bastidor na mesma conversa: o coordenador nunca a conduziu.
    const bastidor = id("8888");
    await pool.query(
      `insert into flow_executions (id, organization_id, flow_id, version_id, status, current_node_id, next_eval_at,
                                    contact_id, conversation_id, input, context, lineage)
       values ($1, $2, $3, $4, 'pending', 'inicio', now(), $5, $6, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb)`,
      [bastidor, ORG, FLUXO, V_FLUXO, c.contactId, c.conversationId],
    );
    expect(await podeFalar(c.conversationId, bastidor)).toEqual({ pode: true, motivo: "nao_coordenado" });

    // Interrupção: o suporte assume — a execução antiga não fala mais.
    const est = await lerEstado(pool, ORG, c.conversationId);
    const r = await transicionar(pool, {
      organizationId: ORG,
      conversationId: c.conversationId,
      versaoEsperada: est!.versao,
      para: { tipo: "agente", agentId: SUPORTE, agentVersionId: V_SUPORTE },
      categoria: "regra",
      motivo: "interrupcao",
    });
    expect(r.ok).toBe(true);
    expect(await podeFalar(c.conversationId, exec)).toEqual({ pode: false, motivo: "nao_e_o_dono" });

    await pool.query(`update conversations set bot_silenced_until = 'infinity' where id = $1`, [c.conversationId]);
    expect(await podeFalar(c.conversationId, exec)).toEqual({ pode: false, motivo: "pessoa_no_comando" });
  });
});

describe("0237 · teto do modelo e retomada após pausa (entrada)", () => {
  const entrada = (c: Conversa) => ({
    organizationId: ORG,
    conversationId: c.conversationId,
    contactId: c.contactId,
    channelSessionId: SESSAO,
    jobId: null,
  });

  it("o teto por hora conta as consultas em `llm_calls`: estourado, o modelo não é chamado e o dono fica", async () => {
    const c = await conversaComOComercial();
    await fala(c, "inbound", "queria entender melhor como funciona a cobrança do plano anual", 0);
    for (let i = 0; i < 3; i += 1) {
      await pool.query(
        `insert into llm_calls (organization_id, contact_id, purpose, provider, model)
         values ($1, $2, 'coordenador_decidir', 'openrouter', 'dublê/decisor')`,
        [ORG, c.contactId],
      );
    }
    const decisor = new DecisorDuble({ escolha: "suporte", confianca: 0.99 });
    const r = await coordenarTurnoDeEntrada(pool, decisor, entrada(c));
    expect(decisor.chamadas).toHaveLength(0);
    expect(r).toMatchObject({ modo: "active", acao: "agente", agentId: COMERCIAL });
  });

  it("abaixo do teto o modelo é consultado (o mesmo cenário, sem consultas na hora)", async () => {
    const c = await conversaComOComercial();
    await fala(c, "inbound", "queria entender melhor como funciona a cobrança do plano anual", 0);
    const decisor = new DecisorDuble({ escolha: "manter", confianca: 0.9 });
    await coordenarTurnoDeEntrada(pool, decisor, entrada(c));
    expect(decisor.chamadas).toHaveLength(1);
  });

  it("cliente volta 3 dias depois com mensagem curta: o modelo decide, e trocar não exige a confiança mínima", async () => {
    const c = await conversaComOComercial();
    await fala(c, "inbound", "quanto custa o plano?", 3 * 24 * 60 + 5);
    await fala(c, "outbound", "O plano custa R$ 99.", 3 * 24 * 60);
    await fala(c, "inbound", "quero cancelar", 0);

    const decisor = new DecisorDuble({ escolha: "suporte", confianca: 0.3 });
    const r = await coordenarTurnoDeEntrada(pool, decisor, entrada(c));
    expect(decisor.chamadas).toHaveLength(1);
    expect(r).toMatchObject({ modo: "active", acao: "agente", agentId: SUPORTE, motivo: "retomada_apos_pausa" });
  });

  it("sem pausa, a mesma mensagem curta segue com quem conduz, sem consultar o modelo", async () => {
    const c = await conversaComOComercial();
    await fala(c, "outbound", "Posso ajudar em mais algo?", 2);
    await fala(c, "inbound", "quero cancelar", 0);
    const decisor = new DecisorDuble({ escolha: "suporte", confianca: 0.99 });
    const r = await coordenarTurnoDeEntrada(pool, decisor, entrada(c));
    expect(decisor.chamadas).toHaveLength(0);
    expect(r).toMatchObject({ modo: "active", acao: "agente", agentId: COMERCIAL });
  });
});
