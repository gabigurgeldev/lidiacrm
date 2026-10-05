import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { Writable } from "node:stream";

/**
 * Integrações via API (0223) no TURNO, contra o Postgres real do clone.
 *
 * O que só um banco de verdade prova — e é a parte de segurança do recurso:
 *
 *   1. Sem código verificado, a consulta à conta NÃO sai (nem chega à rede).
 *   2. Código errado conta tentativa; o certo verifica — e a conta que entra no
 *      caminho é a que o SISTEMA devolveu para aquele e-mail, nunca um valor
 *      que o modelo escreveu.
 *   3. A correção só roda depois do SIM, com os parâmetros congelados na
 *      proposta, e roda UMA vez: o retry do job (o mesmo pré-turno de novo) não
 *      chama o sistema externo de novo.
 *
 * O sistema externo é um `fetch` falso que registra cada chamada; o e-mail é
 * capturado. Nada sai da máquina.
 */

vi.hoisted(() => {
  process.env.AI_CRED_AES_KEY ??= "61fb339da2d4c96519bd0116326108e60148e64bcbd4211f1c420f64fffaf18e";
});

import { carregarDoAgente } from "@/lib/agent-engine/edge/integracoes/repositorio";
import {
  montarFerramentasDeIntegracao,
  resolverPendenciasDoTurno,
  type ContextoDoTurno,
} from "@/lib/agent-engine/edge/integracoes/turno";
import { createLogger } from "@/lib/agent-engine/obs/logger";

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}
const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`, max: 2 });

const ORG = "0223dddd-0000-4000-8000-000000000001";
const SESS = "0223dddd-0000-4000-8000-000000000002";
const CT = "0223dddd-0000-4000-8000-000000000003";
const CONV = "0223dddd-0000-4000-8000-000000000004";
const INT = "0223dddd-0000-4000-8000-000000000005";
const EP_ID = "0223dddd-0000-4000-8000-000000000006";
const EP_DIAG = "0223dddd-0000-4000-8000-000000000007";
const EP_ACAO = "0223dddd-0000-4000-8000-000000000008";
const CONTA = "org-do-cliente-123";

type Chamada = { url: string; method: string; body: string | null; headers: Record<string, string> };
const chamadas: Chamada[] = [];
let codigoEnviado: string | null = null;
const ofertas: string[] = [];

const fetchFalso = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  chamadas.push({
    url,
    method: init?.method ?? "GET",
    body: typeof init?.body === "string" ? init.body : null,
    headers: (init?.headers ?? {}) as Record<string, string>,
  });
  if (url.endsWith("/identidade/buscar")) {
    const email = JSON.parse(String(init?.body ?? "{}")).email;
    const contas = email === "dono@loja.com" ? [{ subject_id: CONTA, nome: "Loja do Dono" }] : [];
    return new Response(JSON.stringify({ contas }), { status: 200 });
  }
  if (url.includes("/diagnostico")) {
    return new Response(JSON.stringify({ conta: { nome: "Loja do Dono", status: "ativa" }, verificacoes: [], token: "segredo" }), {
      status: 200,
    });
  }
  if (url.includes("/acoes/reconectar")) {
    return new Response(JSON.stringify({ ok: true, resultado: "Canal reconectado." }), { status: 200 });
  }
  return new Response("{}", { status: 404 });
}) as typeof fetch;

const silencio = new Writable({ write: (_c, _e, cb) => cb() });

async function contexto(agora: Date): Promise<ContextoDoTurno> {
  const carregado = await carregarDoAgente(pool, ORG, [EP_DIAG, EP_ACAO]);
  return {
    db: pool,
    tenantId: ORG,
    conversationId: CONV,
    contactId: CT,
    agentId: null,
    agora: () => agora,
    log: createLogger(silencio),
    integracoes: carregado.integracoes,
    endpoints: carregado.endpoints,
    fetchImpl: fetchFalso,
    conferirDestino: async () => undefined,
    enviarEmail: async ({ codigo }) => {
      codigoEnviado = codigo;
      return { ok: true };
    },
    emailConfigurado: () => true,
  };
}

async function ferramentas(agora: Date) {
  const ctx = await contexto(agora);
  const integ = await montarFerramentasDeIntegracao(ctx, [], async (corpo) => {
    ofertas.push(corpo);
    return { enviada: true, messageId: null };
  });
  const chamar = (nome: string, input: unknown) =>
    (integ.tools[nome]?.execute as (i: unknown, o: unknown) => Promise<unknown>)(input, {
      toolCallId: "t",
      messages: [],
    });
  return { ctx, integ, chamar };
}

async function clienteDiz(texto: string, quando: Date): Promise<void> {
  await pool.query(
    `insert into messages (organization_id, conversation_id, channel_session_id, contact_id, type, direction, status, body, sent_via, sent_at, created_at)
     values ($1, $2, $3, $4, 'text', 'inbound', 'delivered', $5, 'external_device', $6, $6)`,
    [ORG, CONV, SESS, CT, texto, quando],
  );
}

beforeAll(async () => {
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name) values ($1, 'api-turno', 'API Turno', 'API Turno') on conflict (id) do nothing`,
    [ORG],
  );
  await pool.query(
    `insert into channel_sessions (id, organization_id, waha_session_name, status, webhook_secret_encrypted)
     values ($1, $2, 'api-turno', 'WORKING', '\\x00'::bytea) on conflict (id) do nothing`,
    [SESS, ORG],
  );
  await pool.query(
    `insert into contacts (id, organization_id, display_name, phone_number) values ($1, $2, 'Cliente', '+5511988887777') on conflict (id) do nothing`,
    [CT, ORG],
  );
  await pool.query(
    `insert into conversations (id, organization_id, contact_id, channel_session_id) values ($1, $2, $3, $4) on conflict (id) do nothing`,
    [CONV, ORG, CT, SESS],
  );
  await pool.query(
    `insert into ai_api_integrations (id, organization_id, nome, tipo, base_url, auth_tipo, identidade_modo)
     values ($1, $2, 'Sistema X', 'generica', 'https://sistema.example.com/suporte/v1', 'nenhuma', 'email_otp') on conflict (id) do nothing`,
    [INT, ORG],
  );
  await pool.query(
    `insert into ai_api_endpoints (id, organization_id, integration_id, slug, titulo, metodo, caminho, parametros, modo, exige_identidade, texto_de_confirmacao)
     values
      ($1, $4, $5, 'buscar_conta', 'Buscar conta', 'POST', '/identidade/buscar',
        '[{"nome":"email","tipo":"string","obrigatorio":true,"descricao":"","onde":"body"}]', 'identidade', false, null),
      ($2, $4, $5, 'diagnostico', 'Diagnóstico', 'GET', '/contas/{{conta.id}}/diagnostico', '[]', 'leitura', true, null),
      ($3, $4, $5, 'reconectar', 'Reconectar canal', 'POST', '/contas/{{conta.id}}/acoes/reconectar',
        '[{"nome":"canal","tipo":"string","obrigatorio":true,"descricao":"","onde":"body"}]', 'acao', true, 'Reconectar o canal {{params.canal}}?')
     on conflict (id) do nothing`,
    [EP_ID, EP_DIAG, EP_ACAO, ORG, INT],
  );
  await pool.query(`update ai_api_integrations set identidade_endpoint_id = $1 where id = $2`, [EP_ID, INT]);
});

afterAll(async () => {
  await pool.end();
});

describe("0223 · Integrações via API no turno: identidade, conta e SIM", () => {
  const T0 = new Date("2026-10-05T12:00:00Z");

  it("sem verificação, a consulta à conta não sai para a rede", async () => {
    const { chamar } = await ferramentas(T0);
    const r = (await chamar("consultar_sistema", { endpoint: "sistema_x.diagnostico" })) as { ok: boolean; error?: { code: string } };
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("identidade_necessaria");
    expect(chamadas.filter((c) => c.url.includes("/contas/"))).toHaveLength(0);
  });

  it("o modelo não consegue mandar a conta como parâmetro", async () => {
    const { chamar } = await ferramentas(T0);
    const r = (await chamar("consultar_sistema", {
      endpoint: "sistema_x.diagnostico",
      parametros: { conta: "outra-org" },
    })) as { ok: boolean; error?: { code: string } };
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("parametros_invalidos");
  });

  it("pedir o código responde igual com e sem conta, e o código não volta ao modelo", async () => {
    const { chamar } = await ferramentas(T0);
    const semConta = (await chamar("verificar_identidade", { email: "ninguem@x.com" })) as { message: string };
    expect(codigoEnviado).toBeNull();
    const comConta = (await chamar("verificar_identidade", { email: "dono@loja.com" })) as { message: string };
    expect(codigoEnviado).toMatch(/^\d{6}$/);
    expect(comConta.message.replace(/\S+@\S+/, "")).toBe(semConta.message.replace(/\S+@\S+/, ""));
    expect(JSON.stringify(comConta)).not.toContain(codigoEnviado as string);
  });

  it("código errado conta tentativa; o certo verifica", async () => {
    const errado = codigoEnviado === "000000" ? "111111" : "000000";
    await clienteDiz(errado, new Date(T0.getTime() + 60_000));
    const e1 = await resolverPendenciasDoTurno(await contexto(new Date(T0.getTime() + 61_000)));
    expect(e1).toEqual([{ tipo: "codigo_errado", restantes: 4 }]);

    await clienteDiz(`o código é ${codigoEnviado}`, new Date(T0.getTime() + 120_000));
    const e2 = await resolverPendenciasDoTurno(await contexto(new Date(T0.getTime() + 121_000)));
    expect(e2[0]?.tipo).toBe("verificado");

    // Retry do mesmo job: a mensagem já foi tentada, nada muda.
    const e3 = await resolverPendenciasDoTurno(await contexto(new Date(T0.getTime() + 122_000)));
    expect(e3).toEqual([]);
  });

  it("depois de verificado, a conta no caminho é a que o sistema devolveu — e segredo da resposta não chega ao modelo", async () => {
    const { chamar } = await ferramentas(new Date(T0.getTime() + 130_000));
    const r = (await chamar("consultar_sistema", { endpoint: "sistema_x.diagnostico" })) as {
      ok: boolean;
      dados_externos: string;
    };
    expect(r.ok).toBe(true);
    const diag = chamadas.filter((c) => c.url.includes("/diagnostico"));
    expect(diag.at(-1)?.url).toBe(`https://sistema.example.com/suporte/v1/contas/${CONTA}/diagnostico`);
    expect(r.dados_externos).toContain("[oculto]");
    expect(r.dados_externos).not.toContain("segredo");
  });

  it("a correção só roda depois do SIM, uma vez, com os parâmetros congelados", async () => {
    const tProp = new Date(T0.getTime() + 200_000);
    const { chamar } = await ferramentas(tProp);
    const r = (await chamar("propor_acao", { acao: "sistema_x.reconectar", parametros: { canal: "1" } })) as { status: string };
    expect(r.status).toBe("aguardando_confirmacao");
    expect(ofertas.at(-1)).toContain("Reconectar o canal 1?");
    expect(chamadas.filter((c) => c.url.includes("/acoes/"))).toHaveLength(0);

    // A oferta é carimbada com o relógio do turno; o SIM vem depois dela.
    const oferta = tProp;
    await clienteDiz("sim", new Date(oferta.getTime() + 5_000));
    const agora = new Date(oferta.getTime() + 6_000);

    const e1 = await resolverPendenciasDoTurno(await contexto(agora));
    expect(e1).toEqual([{ tipo: "acao_executada", titulo: "Reconectar canal", resultado: "Canal reconectado." }]);
    const acoes = chamadas.filter((c) => c.url.includes("/acoes/reconectar"));
    expect(acoes).toHaveLength(1);
    expect(acoes[0]?.url).toBe(`https://sistema.example.com/suporte/v1/contas/${CONTA}/acoes/reconectar`);
    expect(JSON.parse(acoes[0]?.body ?? "{}")).toEqual({ canal: "1" });
    expect(acoes[0]?.headers["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/);

    // Retry do job: não executa de novo.
    const e2 = await resolverPendenciasDoTurno(await contexto(new Date(agora.getTime() + 1_000)));
    expect(e2).toEqual([]);
    expect(chamadas.filter((c) => c.url.includes("/acoes/reconectar"))).toHaveLength(1);
  });
});
