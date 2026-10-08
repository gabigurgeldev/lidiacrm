import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { drainTick } from "@/lib/agent-engine/edge/crm/drain";
import { createLogger } from "@/lib/agent-engine/obs/logger";
import { BACKOFF_DA_FALHA, claimJobs, enqueueJob, failJob } from "@/lib/agent-engine/queue/queue";

/**
 * DUAS PROPRIEDADES DA FILA DO AGENTE, medidas contra Postgres real.
 *
 * ─── 1. A rajada do cliente DESLIZA ────────────────────────────────────────
 *
 * Quem escreve "oi" e, 7 s depois, "queria saber o preço" e, 3 s depois, "do
 * plano anual" está no meio de uma frase. A janela era FIXA, contada da 1ª
 * mensagem: o turno saía aos 8 s respondendo às duas primeiras, e a terceira
 * abria outro turno — duas respostas para uma pergunta. Agora cada mensagem
 * empurra o turno para `agora + debounce`, com teto contado da 1ª.
 *
 * O caso que mais importa é o último: a conta SÓ empurra para frente. Um turno
 * adiado para a abertura da janela anti-ban (22h → 7h) não pode ser puxado para
 * agora porque o cliente mandou mais uma mensagem às 23h.
 *
 * Sabotagem medida: sem `debounceMaxMs` (o caminho antigo, `select`), os casos
 * "empurra" e "teto" reprovam — o `run_after` não se move.
 *
 * ─── 2. Job que falhou ESPERA antes de tentar de novo ──────────────────────
 *
 * A nova tentativa ficava claimável no mesmo instante: um provedor de IA
 * respondendo 429 recebia as cinco tentativas em sequência e matava o job em
 * segundos. Sabotagem medida: tirar o `run_after` do `failJob` → os dois casos
 * reprovam (a espera vira ~0).
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 2,
});
const log = createLogger();

const ORG = "f1f1f1f1-0000-4000-8000-000000000001";
const CONTACT = "f1f1f1f1-0000-4000-8000-000000000002";
const SESSION = "f1f1f1f1-0000-4000-8000-000000000003";
const CONV = "f1f1f1f1-0000-4000-8000-000000000004";
const MSG = "f1f1f1f1-0000-4000-8000-000000000005";
const AGENT = "f1f1f1f1-0000-4000-8000-000000000006";
const VERSION = "f1f1f1f1-0000-4000-8000-000000000007";
const CONTACT_FILA = "f1f1f1f1-0000-4000-8000-000000000008";

const RAJADA = {
  batchSize: 20,
  intervalMs: 100,
  idleIntervalMs: 100,
  debounceMs: 8_000,
  debounceMaxMs: 20_000,
  reapTimeoutMs: 300_000,
};

beforeAll(async () => {
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1, 'rajada-desliza', 'Rajada', 'Rajada') on conflict (id) do nothing`,
    [ORG],
  );
  await pool.query(
    `insert into contacts (id, organization_id, name, phone_number)
     values ($1, $2, 'Lead Rajada', '+5511900000881'), ($3, $2, 'Lead Fila', '+5511900000882')
     on conflict (id) do nothing`,
    [CONTACT, ORG, CONTACT_FILA],
  );
  await pool.query(
    `insert into channel_sessions (id, organization_id, waha_session_name, status, webhook_secret_encrypted)
     values ($1, $2, 'rajada-session', 'WORKING', '\\x00'::bytea) on conflict (id) do nothing`,
    [SESSION, ORG],
  );
  await pool.query(
    `insert into conversations (id, organization_id, contact_id, channel_session_id, status, is_group)
     values ($1, $2, $3, $4, 'open', false) on conflict (id) do nothing`,
    [CONV, ORG, CONTACT, SESSION],
  );
  await pool.query(
    `insert into messages (id, organization_id, conversation_id, channel_session_id, contact_id,
                           type, direction, status, body, sent_via, sent_at)
     values ($1, $2, $3, $4, $5, 'text', 'inbound', 'delivered', 'oi', 'external_device', now())
     on conflict (id) do nothing`,
    [MSG, ORG, CONV, SESSION, CONTACT],
  );
  // O drain só gera turno quando há agente publicado para a sessão.
  await pool.query(
    `insert into ai_agents (id, organization_id, name, system_prompt)
     values ($1, $2, 'Agente Rajada', 'você é um atendente') on conflict (id) do nothing`,
    [AGENT, ORG],
  );
  await pool.query(
    `insert into ai_agent_versions (id, organization_id, agent_id, version_number, system_prompt,
                                    provider, model, channel_session_id, status, published_at)
     values ($1, $2, $3, 1, 'você é um atendente', 'anthropic', 'claude-sonnet-4-6', $4, 'published', now())
     on conflict (id) do nothing`,
    [VERSION, ORG, AGENT, SESSION],
  );
  await pool.query(`update ai_agents set published_version_id = $1 where id = $2`, [VERSION, AGENT]);
});

afterAll(async () => {
  await pool.end();
});

async function mensagemDoCliente(): Promise<void> {
  await pool.query(
    `insert into event_log (organization_id, event_type, entity_kind, entity_id, payload, status)
     values ($1::uuid, 'ai_agent.dispatch_requested', 'message', $2::uuid,
             jsonb_build_object('organization_id', $1::text, 'conversation_id', $3::text,
                                'contact_id', $4::text, 'channel_session_id', $5::text,
                                'inbound_message_id', $2::text),
             'pending')`,
    [ORG, MSG, CONV, CONTACT, SESSION],
  );
  await drainTick(pool, RAJADA, log);
}

/** Segundos de agora até o `run_after` do turno pendente do cliente. */
async function faltaParaOTurno(): Promise<{ jobs: number; segundos: number }> {
  const { rows } = await pool.query<{ jobs: string; segundos: string }>(
    `select count(*) as jobs, extract(epoch from max(run_after) - now()) as segundos
       from job_queue
      where organization_id = $1 and contact_id = $2 and kind = 'inbound_turn' and status = 'pending'`,
    [ORG, CONTACT],
  );
  return { jobs: Number(rows[0]!.jobs), segundos: Number(rows[0]!.segundos) };
}

/** Faz de conta que o tempo passou: a 1ª mensagem foi há `idade` s e o turno sai em `falta` s. */
async function passouOTempo(idade: number, falta: number): Promise<void> {
  await pool.query(
    `update job_queue
        set created_at = now() - ($3 * interval '1 second'),
            run_after = now() + ($4 * interval '1 second')
      where organization_id = $1 and contact_id = $2 and kind = 'inbound_turn' and status = 'pending'`,
    [ORG, CONTACT, idade, falta],
  );
}

describe("a rajada do cliente desliza", () => {
  it("a 1ª mensagem agenda o turno para daqui a debounce", async () => {
    await mensagemDoCliente();
    const t = await faltaParaOTurno();
    expect(t.jobs).toBe(1);
    expect(t.segundos).toBeGreaterThan(7);
    expect(t.segundos).toBeLessThanOrEqual(8.5);
  });

  it("mensagem nova no meio da rajada EMPURRA o turno — e não abre outro", async () => {
    await passouOTempo(5, 3);
    await mensagemDoCliente();
    const t = await faltaParaOTurno();
    expect(t.jobs).toBe(1);
    expect(t.segundos).toBeGreaterThan(7);
  });

  it("quem escreve sem parar não espera para sempre: teto contado da 1ª mensagem", async () => {
    // 1ª mensagem há 15 s, teto 20 s → o turno sai em ~5 s, não em 8.
    await passouOTempo(15, 1);
    await mensagemDoCliente();
    const t = await faltaParaOTurno();
    expect(t.jobs).toBe(1);
    expect(t.segundos).toBeGreaterThan(4);
    expect(t.segundos).toBeLessThan(6);
  });

  it("turno adiado para a abertura da janela NÃO é puxado para agora", async () => {
    // 22h30 → adiado para as 7h (~8,5 h). Outra mensagem às 23h não antecipa.
    await passouOTempo(1_800, 30_600);
    await mensagemDoCliente();
    const t = await faltaParaOTurno();
    expect(t.jobs).toBe(1);
    expect(t.segundos).toBeGreaterThan(30_000);
  });
});

describe("job que falhou espera antes de tentar de novo", () => {
  async function falhaUmaVez(jobId: string): Promise<number> {
    await pool.query(`update job_queue set run_after = now() where id = $1`, [jobId]);
    const [claimed] = await claimJobs(pool, { workerId: "espera", maxConcurrency: 1 });
    expect(claimed?.id).toBe(jobId);
    const r = await failJob(pool, jobId, "espera", new Error("429 do provedor"));
    expect(r?.status).toBe("pending");
    const { rows } = await pool.query<{ s: string }>(
      `select extract(epoch from run_after - now()) as s from job_queue where id = $1`,
      [jobId],
    );
    return Number(rows[0]!.s) * 1000;
  }

  it("1ª falha espera a base; 2ª, o dobro — com folga aleatória limitada", async () => {
    await pool.query(`update job_queue set status = 'done' where organization_id = $1`, [ORG]);
    const { job } = await enqueueJob(pool, ORG, {
      kind: "inbound_turn",
      leadId: CONTACT_FILA,
      payload: { conversation_id: CONV, contact_id: CONTACT_FILA, channel_session_id: SESSION },
      maxAttempts: 5,
    });
    const { baseMs, folgaMs } = BACKOFF_DA_FALHA;

    const primeira = await falhaUmaVez(job.id);
    expect(primeira).toBeGreaterThan(baseMs - 500);
    expect(primeira).toBeLessThan(baseMs + folgaMs + 500);

    const segunda = await falhaUmaVez(job.id);
    expect(segunda).toBeGreaterThan(2 * baseMs - 500);
    expect(segunda).toBeLessThan(2 * baseMs + folgaMs + 500);
  });
});
