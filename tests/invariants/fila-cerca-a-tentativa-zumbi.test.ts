import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import type * as Queue from "@/lib/agent-engine/queue/queue";

/**
 * A TENTATIVA ZUMBI NÃO MEXE NA TENTATIVA VIVA.
 *
 * Medido em produção (2026-10-06): um turno pendurou, o reaper o devolveu à fila
 * pelo visibility timeout, e o MESMO worker o re-claimou — enquanto a tentativa
 * antiga seguia viva no processo. O lease era só `locked_by = workerId`, que é
 * POR PROCESSO: as duas tentativas eram indistinguíveis, e a antiga, ao acordar,
 * podia concluir ou falhar o job por cima da nova.
 *
 * A cerca é `attempts`: o claim incrementa e devolve a linha, e
 * `completeJob`/`failJob` recebem a tentativa que fez o claim.
 */
if (!process.env.TEST_DB_CONTAINER) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`, max: 2 });

const ORG = "dddddddd-2026-4006-8000-000000000001";
const WORKER = "agent-engine-mesmo-processo";
let q: typeof Queue;

beforeAll(async () => {
  q = await import("@/lib/agent-engine/queue/queue");
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1, 'org-cerca-zumbi', 'Org Cerca Zumbi LTDA', 'Org Cerca Zumbi')
     on conflict (id) do nothing`,
    [ORG],
  );
});

afterAll(async () => {
  await pool.query(`delete from job_queue where organization_id = $1`, [ORG]);
  await pool.end();
});

async function jobReclaimado(): Promise<{ id: string; tentativaAntiga: number; tentativaNova: number }> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into job_queue (organization_id, contact_id, kind, payload, status, run_after, attempts, locked_by, locked_at)
     values ($1, null, 'watchdog', '{}'::jsonb, 'running', now(), 1, $2, now())
     returning id`,
    [ORG, WORKER],
  );
  const id = rows[0]!.id;
  // O que o reaper + o re-claim fazem: volta a pending e o MESMO worker pega de
  // novo, incrementando `attempts`.
  await pool.query(
    `update job_queue set status = 'running', attempts = attempts + 1, locked_by = $2, locked_at = now() where id = $1`,
    [id, WORKER],
  );
  return { id, tentativaAntiga: 1, tentativaNova: 2 };
}

describe("cerca de tentativa na fila", () => {
  it("⭐ a zumbi não conclui o job da tentativa viva", async () => {
    const { id, tentativaAntiga, tentativaNova } = await jobReclaimado();
    await expect(q.completeJob(pool, id, WORKER, undefined, tentativaAntiga)).rejects.toThrow(/lease do job/);
    const { rows: depois } = await pool.query(`select status from job_queue where id = $1`, [id]);
    expect(depois[0].status).toBe("running");
    await q.completeJob(pool, id, WORKER, undefined, tentativaNova);
    const { rows: fim } = await pool.query(`select status from job_queue where id = $1`, [id]);
    expect(fim[0].status).toBe("done");
  });

  it("⭐ a zumbi não falha o job da tentativa viva", async () => {
    const { id, tentativaAntiga } = await jobReclaimado();
    const r = await q.failJob(pool, id, WORKER, new Error("zumbi acordou"), tentativaAntiga);
    expect(r).toBeNull();
    const { rows } = await pool.query(`select status, last_error from job_queue where id = $1`, [id]);
    expect(rows[0].status).toBe("running");
    expect(rows[0].last_error).toBeNull();
  });

  it("sem tentativa, o comportamento antigo vale (só o lease do worker)", async () => {
    const { id } = await jobReclaimado();
    await q.completeJob(pool, id, WORKER);
    const { rows } = await pool.query(`select status from job_queue where id = $1`, [id]);
    expect(rows[0].status).toBe("done");
  });
});
