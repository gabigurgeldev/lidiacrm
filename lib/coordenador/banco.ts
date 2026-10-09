/**
 * A porta de banco do coordenador.
 *
 * O worker fala com o Postgres por `pg.Pool`; as rotas, pelo client admin do
 * Supabase. O núcleo só precisa de `query(sql, params)`, que o `pg.Pool` (e um
 * `PoolClient` dentro de transação) já satisfazem — o adaptador das rotas está
 * em `./banco-supabase.ts`.
 *
 * Todo SQL daqui filtra `organization_id` explicitamente: quem chama está com
 * privilégio de service role e a RLS não protege nada (anti-pattern 10).
 */
export interface Consulta {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: T[] }>;
}
