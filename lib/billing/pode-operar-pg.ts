/**
 * "Esta organização pode operar?" para os motores que falam com o banco por
 * `pg.Pool` (o worker do agente de IA), e não pelo cliente Supabase.
 *
 * Mesma regra de `./acesso.ts` — só a leitura muda. Não importa `@/lib/env`:
 * o worker é outro processo, com o próprio contrato de ambiente, e um import do
 * schema do app lá dentro derrubaria o worker por variável que ele não usa.
 * Lê `process.env` direto, com os mesmos defaults.
 *
 * FALHA ABERTA: erro de leitura, ou org sem linha, deixa operar. Calar a IA de
 * quem paga por causa de um soluço do banco é pior que deixar um bloqueado
 * responder por alguns segundos. (A org sem linha ganha o trial na primeira
 * leitura pelo app — `lerAssinatura`.)
 */
import type pg from "pg";

import { estadoDeAcesso, type LinhaDeAssinatura } from "./acesso";

export function cobrancaLigadaNoProcesso(): boolean {
  return (process.env.ASAAS_API_KEY ?? "").trim().length > 0;
}

function diasTolerancia(): number {
  const n = Number(process.env.COBRANCA_DIAS_TOLERANCIA);
  return Number.isInteger(n) && n > 0 ? n : 3;
}

export async function organizacaoPodeOperarPg(
  pool: Pick<pg.Pool, "query">,
  organizationId: string,
  agora: Date = new Date(),
): Promise<boolean> {
  if (!cobrancaLigadaNoProcesso()) return true;
  try {
    const { rows } = await pool.query<LinhaDeAssinatura>(
      `select status, isenta, trial_termina_em::text as trial_termina_em, pago_ate::text as pago_ate
         from public.assinaturas where organization_id = $1`,
      [organizationId],
    );
    const linha = rows[0];
    if (!linha) return true;
    return estadoDeAcesso(linha, { ligada: true, diasTolerancia: diasTolerancia() }, agora).liberado;
  } catch {
    return true;
  }
}
