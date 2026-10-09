/**
 * Estender o teste grátis de uma organização — a regra pura, sem I/O.
 *
 * Quem decide é o painel da plataforma (`/admin/tenants/[id]`), à mão. Não
 * existe prorrogação automática: o trial vencido continua bloqueando no dia
 * seguinte (ver o cabeçalho de `./acesso.ts`). O que existe é o dono da
 * instalação dar mais dias a quem ele quiser, e isso fica no audit.
 *
 * Tela e rota usam a MESMA `novaDataDoTeste`: a prévia "novo fim: dd/mm" que o
 * admin vê antes de confirmar é a data que a rota grava, e não uma conta
 * parecida feita em outro lugar.
 */
import type { LinhaDeAssinatura } from "./acesso";

const DIA_MS = 24 * 60 * 60 * 1000;

/** Teto por operação. Mais que um ano não é teste, é isenção — e isenção tem chave própria. */
export const MAX_DIAS_DE_EXTENSAO = 365;

/**
 * A base é o MAIOR entre agora e o fim atual do teste.
 *
 * Somar ao fim atual quando ele já passou daria menos dias do que o admin
 * pediu (um teste vencido há 10 dias, +7, continuaria vencido). Somar a agora
 * quando ele ainda está no futuro jogaria fora os dias que a organização já
 * tinha. Os dois erros são silenciosos, e é por isso que a regra mora aqui.
 */
export function novaDataDoTeste(atual: string | Date | null, agora: Date, dias: number): Date {
  const fim = atual === null ? Number.NaN : new Date(atual).getTime();
  const base = Number.isFinite(fim) ? Math.max(fim, agora.getTime()) : agora.getTime();
  return new Date(base + dias * DIA_MS);
}

export type MotivoDeRecusa = "cancelada" | "paga" | "isenta";

export type PodeEstender = { pode: true } | { pode: false; motivo: MotivoDeRecusa };

/**
 * Quando estender o teste não faz sentido — e dizer isso em vez de gravar.
 *
 * - `cancelada`: o cancelamento foi decisão da organização, e a regra de
 *   acesso ignora o trial de assinatura cancelada. Gravar a data mudaria o
 *   banco sem liberar nada, e o admin acharia que liberou.
 * - `paga`: a organização já está liberada pelo pagamento; o teste estendido
 *   ficaria escondido atrás do `pago_ate` e confundiria a próxima leitura.
 * - `isenta`: já nunca é bloqueada.
 */
export function podeEstender(a: LinhaDeAssinatura, agora: Date = new Date()): PodeEstender {
  if (a.status === "cancelada") return { pode: false, motivo: "cancelada" };
  if (a.isenta) return { pode: false, motivo: "isenta" };
  const pagoAte = a.pago_ate ? new Date(a.pago_ate).getTime() : Number.NaN;
  if (Number.isFinite(pagoAte) && pagoAte > agora.getTime()) return { pode: false, motivo: "paga" };
  return { pode: true };
}

/**
 * O status depois de estender.
 *
 * Quem NUNCA pagou volta a `trial` (estava `trial` ou, no máximo, ficou com o
 * rótulo de um trial vencido). Quem já pagou e atrasou mantém o status que
 * tem: o acesso volta pelo teste (a regra de acesso pergunta pelo trial antes
 * da tolerância), mas a história de pagamento não é reescrita.
 */
export function statusDepoisDeEstender(a: LinhaDeAssinatura): string {
  return a.pago_ate === null ? "trial" : a.status;
}
