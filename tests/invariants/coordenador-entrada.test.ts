import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import type { Decisao, Decisor, PedidoDeDecisao } from "@/lib/coordenador/decisor/contrato";
import { coordenarTurnoDeEntrada, type EntradaDoTurno } from "@/lib/coordenador/entrada";

/**
 * A entrada do coordenador (M2) contra o banco que o clone recebe.
 *
 * O que se cobra aqui é o efeito no ESTADO, não a lógica pura (essa está em
 * `lib/coordenador/decidir.test.ts`):
 *
 *   - sem política, `off` e nenhuma linha escrita — quem não liga não muda;
 *   - `shadow` grava a recomendação e não toca em dono, admissão nem geração;
 *   - `active` entrega pela única porta, admite o lote e devolve a geração;
 *   - reentrega do mesmo turno (crash, lease vencido) não decide de novo;
 *   - continuidade: resposta curta ao agente atual não consulta o modelo;
 *   - pessoa no comando: a mensagem é admitida para ninguém automático;
 *   - decisor falhou: cai no destino padrão, nunca num destino arbitrário;
 *   - o lote é o que veio depois da última fala da empresa, não o histórico.
 *
 * O decisor é um dublê: o seam real de LLM é provado em
 * `lib/coordenador/nucleo.test.ts`, e aqui o que importa é o que o
 * coordenador faz com a resposta dele.
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

const ORG = "0229e000-0000-4000-8000-000000000001";
const SESSAO_OFF = "0229e000-2222-4000-8000-000000000001";
const SESSAO_SHADOW = "0229e000-2222-4000-8000-000000000002";
const SESSAO_ATIVA = "0229e000-2222-4000-8000-000000000003";
const COMERCIAL = "0229e000-5555-4000-8000-000000000001";
const SUPORTE = "0229e000-5555-4000-8000-000000000002";
const V_COMERCIAL = "0229e000-5555-4000-8000-0000000000a1";
const V_SUPORTE = "0229e000-5555-4000-8000-0000000000a2";
const FLUXO = "0229e000-7777-4000-8000-000000000001";
const V_FLUXO = "0229e000-7777-4000-8000-0000000000a1";

let seq = 0;
function id(prefixo: string): string {
  seq += 1;
  return `0229e000-${prefixo}-4000-8000-${String(seq).padStart(12, "0")}`;
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

const nuncaChamado = () => new DecisorDuble({ status: "falhou" });

async function conversa(sessao: string): Promise<EntradaDoTurno> {
  const contato = id("3333");
  const conv = id("4444");
  await pool.query(`insert into contacts (id, organization_id, display_name) values ($1, $2, 'Cliente sintético')`, [
    contato,
    ORG,
  ]);
  await pool.query(
    `insert into conversations (id, organization_id, contact_id, channel_session_id, status)
     values ($1, $2, $3, $4, 'open')`,
    [conv, ORG, contato, sessao],
  );
  return { organizationId: ORG, conversationId: conv, contactId: contato, channelSessionId: sessao, jobId: null };
}

async function fala(e: EntradaDoTurno, direcao: "inbound" | "outbound", texto: string, haSegundos = 0): Promise<string> {
  const msg = id("6666");
  await pool.query(
    `insert into messages (id, organization_id, conversation_id, channel_session_id, contact_id, type, direction, body, sent_at)
     values ($1, $2, $3, $4, $5, 'text', $6, $7, now() - make_interval(secs => $8))`,
    [msg, ORG, e.conversationId, e.channelSessionId, e.contactId, direcao, texto, haSegundos],
  );
  return msg;
}

async function contar(sqlText: string, params: unknown[]): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(sqlText, params);
  return Number(rows[0]?.n ?? 0);
}

async function estado(e: EntradaDoTurno) {
  const { rows } = await pool.query<{ dono_tipo: string; dono_agent_id: string | null; geracao: string }>(
    `select dono_tipo, dono_agent_id, geracao::text from coord_estado_conversa
      where organization_id = $1 and conversation_id = $2`,
    [ORG, e.conversationId],
  );
  return rows[0] ?? null;
}

async function publicar(sessao: string, modo: "shadow" | "active"): Promise<void> {
  const config = {
    destino_padrao: "suporte",
    regras_de_entrada: [
      { id: "planos", quando: "contem", termos: ["plano"], destino: "comercial" },
      { id: "suporte", quando: "contem", termos: ["suporte"], destino: "suporte" },
      { id: "agenda", quando: "contem", termos: ["agendar"], destino: "agendamento" },
    ],
  };
  const destinos = [
    { chave: "comercial", tipo: "agente", agent_id: COMERCIAL, quando_usar: "Planos e preços" },
    { chave: "suporte", tipo: "agente", agent_id: SUPORTE, quando_usar: "Dúvidas e problemas" },
    { chave: "agendamento", tipo: "fluxo", flow_id: FLUXO, quando_usar: "Marcar horário" },
  ];
  await pool.query(`select public.fn_coord_publicar_politica($1, $2, $3, $4::jsonb, $5::jsonb, null)`, [
    ORG,
    sessao,
    modo,
    JSON.stringify(config),
    JSON.stringify(destinos),
  ]);
}

beforeAll(async () => {
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1, 'coord-entrada', 'Coord Entrada', 'Coord Entrada')`,
    [ORG],
  );
  for (const [s, nome] of [
    [SESSAO_OFF, "coord-entrada-off"],
    [SESSAO_SHADOW, "coord-entrada-shadow"],
    [SESSAO_ATIVA, "coord-entrada-ativa"],
  ] as const) {
    await pool.query(
      `insert into channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
       values ($1, $2, $3, '\\x00'::bytea)`,
      [s, ORG, nome],
    );
  }
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
      [versao, ORG, agente, SESSAO_ATIVA],
    );
    await pool.query(`update ai_agents set published_version_id = $2 where id = $1`, [agente, versao]);
  }
  await pool.query(
    `insert into flows (id, organization_id, name, status) values ($1, $2, 'Agendamento', 'draft')`,
    [FLUXO, ORG],
  );
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
  await publicar(SESSAO_SHADOW, "shadow");
  await publicar(SESSAO_ATIVA, "active");
});

afterAll(async () => {
  await pool.end();
});

describe("0229 · entrada do coordenador", () => {
  it("sem política: `off`, nenhuma linha escrita — quem não liga não muda", async () => {
    const e = await conversa(SESSAO_OFF);
    await fala(e, "inbound", "quero saber do plano");
    const decisor = nuncaChamado();
    expect(await coordenarTurnoDeEntrada(pool, decisor, e)).toEqual({ modo: "off" });
    expect(await contar(`select count(*) n from coord_transicoes where conversation_id = $1`, [e.conversationId])).toBe(0);
    expect(await estado(e)).toBeNull();
    expect(decisor.chamadas).toHaveLength(0);
  });

  it("shadow: grava a recomendação e não toca em dono, admissão nem geração", async () => {
    const e = await conversa(SESSAO_SHADOW);
    await fala(e, "inbound", "quero saber do plano");
    const r = await coordenarTurnoDeEntrada(pool, nuncaChamado(), e);
    expect(r).toEqual({ modo: "shadow", recomendacao: "destino" });
    expect(
      await contar(
        `select count(*) n from coord_transicoes where conversation_id = $1 and status = 'shadow' and para_id = $2`,
        [e.conversationId, COMERCIAL],
      ),
    ).toBe(1);
    expect(await estado(e)).toBeNull();
    expect(await contar(`select count(*) n from coord_admissoes where conversation_id = $1`, [e.conversationId])).toBe(0);
  });

  it("active por regra: entrega ao agente, admite o lote e devolve a geração; a reentrega não decide de novo", async () => {
    const e = await conversa(SESSAO_ATIVA);
    await fala(e, "inbound", "oi", 5);
    await fala(e, "inbound", "queria ver o plano anual");
    const decisor = nuncaChamado();
    const r = await coordenarTurnoDeEntrada(pool, decisor, e);
    expect(r).toMatchObject({ modo: "active", acao: "agente", agentId: COMERCIAL, geracao: 1, motivo: "primeira_mensagem_regra" });
    expect(await estado(e)).toMatchObject({ dono_tipo: "agente", dono_agent_id: COMERCIAL, geracao: "1" });
    expect(
      await contar(
        `select count(*) n from coord_admissoes where conversation_id = $1 and consumidor_tipo = 'agente' and consumidor_id = $2`,
        [e.conversationId, COMERCIAL],
      ),
    ).toBe(2);

    // Mesmo turno retomado: tudo já admitido, mesma geração, sem transição nova.
    const de_novo = await coordenarTurnoDeEntrada(pool, decisor, e);
    expect(de_novo).toMatchObject({ acao: "agente", agentId: COMERCIAL, geracao: 1, motivo: "continua_responsavel" });
    expect(
      await contar(`select count(*) n from coord_transicoes where conversation_id = $1 and status = 'aplicada'`, [
        e.conversationId,
      ]),
    ).toBe(1);
    expect(decisor.chamadas).toHaveLength(0);
  });

  it("continuidade: resposta curta ao agente atual segue com ele, sem consultar o modelo", async () => {
    const e = await conversa(SESSAO_ATIVA);
    await fala(e, "inbound", "quero o plano", 30);
    const decisor = new DecisorDuble({ escolha: "suporte", confianca: 0.99 });
    await coordenarTurnoDeEntrada(pool, decisor, e);
    await fala(e, "outbound", "Temos dois planos. Mensal ou anual?", 20);
    await fala(e, "inbound", "anual");
    const r = await coordenarTurnoDeEntrada(pool, decisor, e);
    expect(r).toMatchObject({ acao: "agente", agentId: COMERCIAL, geracao: 1 });
    expect(decisor.chamadas).toHaveLength(0);
  });

  it("pessoa no comando: a mensagem é admitida para ninguém automático e nenhum agente é escolhido", async () => {
    const e = await conversa(SESSAO_ATIVA);
    await pool.query(`update contacts set force_human = true where id = $1`, [e.contactId]);
    const msg = await fala(e, "inbound", "quero o plano");
    const r = await coordenarTurnoDeEntrada(pool, nuncaChamado(), e);
    expect(r).toMatchObject({ modo: "active", acao: "nada" });
    expect(
      await contar(`select count(*) n from coord_admissoes where message_id = $1 and consumidor_tipo = 'nenhum'`, [msg]),
    ).toBe(1);
    expect((await estado(e))?.dono_tipo ?? "nenhum").not.toBe("agente");
  });

  it("decisor falhou: cai no destino padrão, registrado como fallback — nunca num destino inventado", async () => {
    const e = await conversa(SESSAO_ATIVA);
    await fala(e, "inbound", "boa tarde, tenho uma pergunta sobre a minha conta");
    const decisor = new DecisorDuble({ status: "falhou", escolha: null, erro: "sem crédito" });
    const r = await coordenarTurnoDeEntrada(pool, decisor, e);
    expect(decisor.chamadas).toHaveLength(1);
    expect(r).toMatchObject({ modo: "active", acao: "agente", agentId: SUPORTE });
    expect(
      await contar(
        `select count(*) n from coord_transicoes where conversation_id = $1 and status = 'aplicada' and categoria = 'fallback'`,
        [e.conversationId],
      ),
    ).toBe(1);
  });

  it("destino fluxo: a execução nasce no gatilho e a conversa passa a ser dela, na mesma transação", async () => {
    const e = await conversa(SESSAO_ATIVA);
    await fala(e, "inbound", "quero agendar uma visita");
    const r = await coordenarTurnoDeEntrada(pool, nuncaChamado(), e);
    expect(r).toMatchObject({ modo: "active", acao: "nada", motivo: "primeira_mensagem_regra" });
    const { rows } = await pool.query<{ id: string; current_node_id: string; status: string }>(
      `select x.id, x.current_node_id, x.status from coord_estado_conversa s
         join flow_executions x on x.id = s.dono_execution_id
        where s.conversation_id = $1 and s.dono_tipo = 'fluxo'`,
      [e.conversationId],
    );
    expect(rows[0]).toMatchObject({ current_node_id: "inicio", status: "pending" });

    // Enquanto o fluxo vive, a próxima mensagem é dele.
    await fala(e, "inbound", "amanhã às 10");
    expect(await coordenarTurnoDeEntrada(pool, nuncaChamado(), e)).toMatchObject({
      acao: "nada",
      motivo: "resposta_a_pergunta",
    });

    // O fluxo terminou: a conversa volta à decisão em vez de ficar muda.
    await pool.query(
      `update flow_executions set status = 'completed', next_eval_at = null, completed_at = now() where id = $1`,
      [rows[0]!.id],
    );
    await fala(e, "outbound", "Agendado!", 0);
    await fala(e, "inbound", "agora preciso de suporte com o acesso");
    expect(await coordenarTurnoDeEntrada(pool, nuncaChamado(), e)).toMatchObject({
      acao: "agente",
      agentId: SUPORTE,
    });
  });

  it("o fluxo ENTREGOU a conversa (handoff): mesmo vivo, deixa de ser dono e o coordenador escolhe o agente", async () => {
    const e = await conversa(SESSAO_ATIVA);
    await fala(e, "inbound", "quero agendar", 20);
    await coordenarTurnoDeEntrada(pool, nuncaChamado(), e);
    const { rows } = await pool.query<{ id: string }>(
      `select dono_execution_id as id from coord_estado_conversa where conversation_id = $1`,
      [e.conversationId],
    );
    const execucao = rows[0]!.id;
    await fala(e, "outbound", "Qual o seu problema?", 10);
    await fala(e, "inbound", "preciso de suporte com o login");

    const r = await coordenarTurnoDeEntrada(pool, nuncaChamado(), { ...e, liberadoPorFluxo: execucao });
    expect(r).toMatchObject({ modo: "active", acao: "agente", agentId: SUPORTE });
  });

  it("o lote é o que veio depois da última fala da empresa — o histórico já respondido não decide", async () => {
    const e = await conversa(SESSAO_ATIVA);
    // Antes da ativação: perguntou do plano e foi respondido pelo legado.
    await fala(e, "inbound", "quanto custa o plano", 60);
    await fala(e, "outbound", "O plano custa R$ 99.", 50);
    await fala(e, "inbound", "preciso de suporte com o acesso");
    const r = await coordenarTurnoDeEntrada(pool, nuncaChamado(), e);
    expect(r).toMatchObject({ acao: "agente", agentId: SUPORTE });
    const { rows } = await pool.query<{ lote: number }>(
      `select (detalhe->>'lote')::int as lote from coord_transicoes
        where conversation_id = $1 and status = 'aplicada'`,
      [e.conversationId],
    );
    expect(rows[0]?.lote).toBe(1);
  });
});
