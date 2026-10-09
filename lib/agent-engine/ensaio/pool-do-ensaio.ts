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
 * ─── A escrita "por fora" da cadeia de envio ───────────────────────────────
 *
 * Em produção, `pool.query` pega OUTRA conexão, em autocommit. A cadeia de envio
 * conta com isso: o rastro do veto (`persistTrace`) e o aviso de teto são
 * gravados pelo pool ANTES do `rollback` da transação do envio, e sobrevivem a
 * ele. Aqui o pool é o mesmo cliente, dentro do savepoint — e o `rollback to
 * savepoint` apagaria justamente o rastro que diz por que a mensagem não saiu.
 *
 * Então toda escrita feita pelo `pool` com savepoint aberto é anotada, e
 * REAPLICADA depois do `rollback to savepoint`: o mesmo desfecho da produção.
 * Ela não depende do que o savepoint desfez — em produção, a outra conexão nem
 * enxergava aquilo, que ainda não tinha sido confirmado. Cada reaplicação roda
 * no seu próprio savepoint: uma falha ali vira só a linha que faltou, como o
 * `try/catch` em volta dessas escritas faz em produção.
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
const SO_LEITURA = /^select\b/i;

type Consulta = string | { text: string; values?: unknown[] };

interface Escrita {
  texto: string;
  params: unknown[] | undefined;
}

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
  /** Escritas do `pool` feitas em cada nível de savepoint, para reaplicar no rollback. */
  const porFora: Escrita[][] = [];

  const executar = (texto: string, params: unknown[] | undefined): Promise<pg.QueryResult> => {
    if (TRAVA_POR_CHAVE.test(texto) && Array.isArray(params) && typeof params[0] === 'string') {
      const [chave, ...resto] = params;
      return cliente.query(texto, [`ensaio:${idDoEnsaio}:${chave}`, ...resto]);
    }
    return params === undefined ? cliente.query(texto) : cliente.query(texto, params);
  };

  const normalizar = (consulta: Consulta, valores?: unknown[]): Escrita => ({
    texto: textoDe(consulta).trim(),
    params: valores ?? (typeof consulta === 'string' ? undefined : consulta.values),
  });

  const reaplicar = async (escritas: Escrita[]): Promise<void> => {
    for (const e of escritas) {
      await cliente.query('savepoint ensaio_reaplica');
      try {
        await executar(e.texto, e.params);
        await cliente.query('release savepoint ensaio_reaplica');
      } catch {
        await cliente.query('rollback to savepoint ensaio_reaplica');
      }
    }
  };

  const fachadaDoCliente = {
    query: async (consulta: Consulta, valores?: unknown[]) => {
      const comando = textoDe(consulta).trim().toLowerCase().replace(/;$/, '');
      if (comando === 'begin') {
        contador += 1;
        const nome = `ensaio_sp_${contador}`;
        pilha.push(nome);
        porFora.push([]);
        return cliente.query(`savepoint ${nome}`);
      }
      if (comando === 'commit') {
        const nome = pilha.pop();
        if (nome === undefined) throw new Error('ensaio: commit sem begin correspondente');
        // Confirmadas junto: se o nível de cima for desfeito, elas voltam com ele.
        const escritas = porFora.pop() ?? [];
        porFora.at(-1)?.push(...escritas);
        return cliente.query(`release savepoint ${nome}`);
      }
      if (comando === 'rollback') {
        const nome = pilha.pop();
        if (nome === undefined) throw new Error('ensaio: rollback sem begin correspondente');
        const escritas = porFora.pop() ?? [];
        const r = await cliente.query(`rollback to savepoint ${nome}`);
        await reaplicar(escritas);
        porFora.at(-1)?.push(...escritas);
        return r;
      }
      const { texto, params } = normalizar(consulta, valores);
      return executar(texto, params);
    },
    release: () => {
      // O cliente pertence ao ensaio, que o devolve ao pool real no fim.
    },
  };

  const pool = {
    query: (consulta: Consulta, valores?: unknown[]) => {
      const escrita = normalizar(consulta, valores);
      if (porFora.length > 0 && !SO_LEITURA.test(escrita.texto)) porFora.at(-1)!.push(escrita);
      return executar(escrita.texto, escrita.params);
    },
    connect: async () => fachadaDoCliente,
  };

  return {
    pool: pool as unknown as pg.Pool,
    abertas: () => pilha.length,
  };
}
