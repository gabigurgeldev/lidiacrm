/**
 * Quem vê a agenda de quem (migration 0249).
 *
 * Atendente (agent) e viewer veem só a própria agenda; gerente, admin e
 * platform admin veem a organização inteira. A regra que VALE é a RLS
 * (`fn_can_view_appointment`); esta função existe para a tela e a rota
 * dizerem a mesma coisa que o banco — esconder o filtro de pessoas de quem só
 * vê a si mesmo, e recortar a listagem também quando o client é o admin.
 *
 * Pura e sem I/O: o papel já foi resolvido por `requireRole()` / `requireAuth()`.
 */
import { roleAtLeast } from "@/lib/auth/types";

export type EscopoDaAgenda = "proprio" | "organizacao";

export function escopoDaAgenda(
  role: string | null | undefined,
  isPlatformAdmin: boolean,
): EscopoDaAgenda {
  return isPlatformAdmin || roleAtLeast(role, "manager") ? "organizacao" : "proprio";
}
