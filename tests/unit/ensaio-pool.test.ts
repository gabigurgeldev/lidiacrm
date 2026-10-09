/**
 * A fachada do ensaio: o turno inteiro numa transação só, e nada vira commit.
 *
 * O turno usa o pool de dois jeitos — `query` solto e `connect()` com
 * `begin`/`commit` próprios (a cadeia de envio). Se o `commit` da cadeia de envio
 * chegasse ao Postgres como `commit`, ele fecharia a transação do ensaio e
 * GRAVARIA o contato, a conversa e as mensagens sintéticas no CRM real.
 *
 * E a trava por número: dentro do ensaio ela duraria até o fim da transação; com
 * a chave original, o número REAL ficaria sem enviar enquanto o teste rodasse.
 */
import type pg from "pg";
import { describe, expect, it } from "vitest";

import { poolDoEnsaio } from "@/lib/agent-engine/ensaio/pool-do-ensaio";

function clienteGravador() {
  const sql: Array<{ texto: string; params?: unknown[] }> = [];
  const cliente = {
    query: async (texto: string, params?: unknown[]) => {
      sql.push(params === undefined ? { texto } : { texto, params });
      return { rows: [], rowCount: 0 };
    },
    release: () => {
      throw new Error("o cliente do ensaio não pode ser devolvido pelo turno");
    },
  };
  return { cliente: cliente as unknown as pg.PoolClient, sql };
}

describe("ensaio: fachada do pool", () => {
  it("begin/commit/rollback da cadeia de envio viram savepoints", async () => {
    const { cliente, sql } = clienteGravador();
    const { pool, abertas } = poolDoEnsaio(cliente, "e1");

    const c = await pool.connect();
    await c.query("BEGIN");
    await c.query("select 1");
    await c.query("commit;");
    await c.query("begin");
    await c.query("rollback");
    c.release();

    const textos = sql.map((s) => s.texto.toLowerCase());
    expect(textos).toEqual([
      "savepoint ensaio_sp_1",
      "select 1",
      "release savepoint ensaio_sp_1",
      "savepoint ensaio_sp_2",
      "rollback to savepoint ensaio_sp_2",
    ]);
    expect(textos.some((t) => /^(begin|commit|rollback);?$/.test(t))).toBe(false);
    expect(abertas()).toBe(0);
  });

  it("savepoints aninhados fecham na ordem inversa", async () => {
    const { cliente, sql } = clienteGravador();
    const { pool, abertas } = poolDoEnsaio(cliente, "e1");
    const c = await pool.connect();
    await c.query("begin");
    await c.query("begin");
    expect(abertas()).toBe(2);
    await c.query("commit");
    await c.query("commit");
    expect(sql.map((s) => s.texto)).toEqual([
      "savepoint ensaio_sp_1",
      "savepoint ensaio_sp_2",
      "release savepoint ensaio_sp_2",
      "release savepoint ensaio_sp_1",
    ]);
    expect(abertas()).toBe(0);
  });

  it("commit sem begin é erro, não commit de verdade", async () => {
    const { cliente, sql } = clienteGravador();
    const { pool } = poolDoEnsaio(cliente, "e1");
    const c = await pool.connect();
    await expect(c.query("commit")).rejects.toThrow(/sem begin/);
    expect(sql).toEqual([]);
  });

  it("a trava do número ganha a chave do ensaio — pelo pool e pela conexão", async () => {
    const { cliente, sql } = clienteGravador();
    const { pool } = poolDoEnsaio(cliente, "e1");
    const trava = "select pg_advisory_xact_lock(hashtext($1))";

    await pool.query(trava, ["sessao-real"]);
    const c = await pool.connect();
    await c.query({ text: trava, values: ["sessao-real"] });

    expect(sql.map((s) => s.params)).toEqual([["ensaio:e1:sessao-real"], ["ensaio:e1:sessao-real"]]);
  });

  it("consultas comuns passam intactas, com e sem parâmetros", async () => {
    const { cliente, sql } = clienteGravador();
    const { pool } = poolDoEnsaio(cliente, "e1");
    await pool.query("select $1::text", ["x"]);
    await pool.query("select now()");
    expect(sql).toEqual([{ texto: "select $1::text", params: ["x"] }, { texto: "select now()" }]);
  });
});
