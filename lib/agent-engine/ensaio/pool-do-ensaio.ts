/**
 * UMA TRANSAÇÃO SÓ, FINGINDO SER UM POOL — para o turno do agente rodar inteiro
 * e nada ficar.
 *
 * O turno recebe um `pg.Pool` e o usa de dois jeitos: `pool.query(...)` solto, e
 * `pool.connect()` com `begin`/`commit` próprio (a cadeia de envio, em
 * `guardrails/before-send.ts`). Esta fachada atende os dois sobre UM cliente,
 * dentro de UM `BEGIN` aberto pelo ensaio:
 *
 *  - `query` vai direto ao cliente — tudo dentro da transação;
 *  - `connect()` devolve uma fachada cujo `begin`/`commit`/`rollback` viram
 *    `savepoint`/`release savepoint`/`rollback to savepoint`. O `commit` da
 *    cadeia de envio NÃO pode virar commit de verdade: ele gravaria o ensaio;
 *  - `release()` da fachada não devolve nada — o cliente é do ensaio.
 *
 * ─── A trava do número ─────────────────────────────────────────────────────
 *
 * A cadeia de envio serializa por número com `pg_advisory_xact_lock(hashtext(
 * <channel_session_id>))`. Dentro do ensaio essa trava duraria até o fim da
 * transação — e o número REAL ficaria sem conseguir enviar enquanto o teste
 * rodasse. A fachada troca a chave por `ensaio:<id>:<chave>`: o ensaio continua
 * serializando contra ele mesmo e nunca contra o atendimento de verdade.
 *
 * O cliente do pg já enfileira consultas: duas chamadas concorrentes (os
 * classificadores rodam em paralelo) saem em ordem, sem disputa.
 */
import type pg from 'pg';

const TRAVA_POR_CHAVE = /pg_advisory_xact_lock\(\s*hashtext\(\s*\$1\s*\)\s*\)/i;

type Consulta = string | { text: string; values?: unknown[] };

function textoDe(consulta: Consulta): string {
  return typeof consulta === 'string' ? consulta : consulta.text;
}

export interface PoolDoEnsaio {
  /** O objeto a entregar ao turno no lugar do pool. */
  pool: pg.Pool;
  /** Quantas transações aninhadas (`begin` da cadeia de envio) ficaram abertas — tem de terminar em zero. */
  abertas(): number;
}

export function poolDoEnsaio(cliente: pg.PoolClient, idDoEnsaio: string): PoolDoEnsaio {
  let contador = 0;
  const pilha: string[] = [];

  const consultar = (consulta: Consulta, valores?: unknown[]): Promise<pg.QueryResult> => {
    const texto = textoDe(consulta).trim();
    const params = valores ?? (typeof consulta === 'string' ? undefined : consulta.values);

    if (TRAVA_POR_CHAVE.test(texto) && Array.isArray(params) && typeof params[0] === 'string') {
      const [chave, ...resto] = params;
      return cliente.query(texto, [`ensaio:${idDoEnsaio}:${chave}`, ...resto]);
    }
    return params === undefined ? cliente.query(texto) : cliente.query(texto, params);
  };

  const fachadaDoCliente = {
    query: async (consulta: Consulta, valores?: unknown[]) => {
      const comando = textoDe(consulta).trim().toLowerCase().replace(/;$/, '');
      if (comando === 'begin') {
        contador += 1;
        const nome = `ensaio_sp_${contador}`;
        pilha.push(nome);
        return cliente.query(`savepoint ${nome}`);
      }
      if (comando === 'commit') {
        const nome = pilha.pop();
        if (nome === undefined) throw new Error('ensaio: commit sem begin correspondente');
        return cliente.query(`release savepoint ${nome}`);
      }
      if (comando === 'rollback') {
        const nome = pilha.pop();
        if (nome === undefined) throw new Error('ensaio: rollback sem begin correspondente');
        return cliente.query(`rollback to savepoint ${nome}`);
      }
      return consultar(consulta, valores);
    },
    release: () => {
      // O cliente pertence ao ensaio, que o devolve ao pool real no fim.
    },
  };

  const pool = {
    query: (consulta: Consulta, valores?: unknown[]) => consultar(consulta, valores),
    connect: async () => fachadaDoCliente,
  };

  return {
    pool: pool as unknown as pg.Pool,
    abertas: () => pilha.length,
  };
}
