/**
 * Regras de gestão de usuários do painel da plataforma — puras, sem I/O.
 *
 * As rotas de `app/api/v1/admin/users/**` consultam o banco e o Auth, e depois
 * perguntam AQUI se a ação pode acontecer. A regra mora separada da rota por um
 * motivo só: ela é o que impede o painel de trancar a instalação para fora de
 * si mesma, e isso precisa de teste que não dependa de montar um Supabase falso.
 *
 * O que estas regras protegem, em ordem de gravidade:
 *  1. Ninguém suspende ou exclui A SI MESMO — o painel da plataforma não tem
 *     segundo caminho de volta; quem se tranca precisa de SQL na VPS.
 *  2. O ÚLTIMO platform admin ativo não é suspenso nem excluído — pelo mesmo
 *     motivo, e ainda que quem aja seja outra pessoa.
 *  3. O ÚLTIMO admin de uma organização não é rebaixado nem removido — a
 *     organização ficaria sem ninguém capaz de gerir a própria equipe. É a
 *     mesma regra de `app/api/v1/team/[user_id]/_shared.ts` e `/revoke`.
 */
import type { Role } from "@/lib/schemas/team";

/**
 * `ban_duration` para suspensão. O GoTrue não tem "banido para sempre": a
 * duração é uma string de `time.ParseDuration`, e 100 anos é o "até alguém
 * reativar" prático. Reativar é `"none"`.
 */
export const DURACAO_DA_SUSPENSAO = "876000h";

export type EstadoDaConta = "ativo" | "suspenso" | "pendente";

/** O que fica gravado em `app_metadata.suspensao` enquanto a conta está suspensa. */
export interface SuspensaoRegistrada {
  motivo: string;
  por: string;
  em: string;
}

export function estadoDaConta(
  u: {
    banned_until: string | null;
    email_confirmed_at: string | null;
    last_sign_in_at: string | null;
  },
  agora: Date = new Date(),
): EstadoDaConta {
  if (u.banned_until && new Date(u.banned_until).getTime() > agora.getTime()) {
    return "suspenso";
  }
  // Nunca entrou e nunca confirmou: a conta existe, mas ninguém a usou ainda.
  if (!u.last_sign_in_at && !u.email_confirmed_at) return "pendente";
  return "ativo";
}

/**
 * Recusa de uma ação. Na rota vira sempre 409 `state_conflict` (código
 * canônico de `lib/api/errors.ts`), com `motivo` em `details` — quem consome
 * distingue o caso sem que o contrato de wire ganhe código inventado.
 */
export interface Recusa {
  motivo: "estado" | "ultimo_admin" | "propria_conta";
  message: string;
}

export type AcaoNaConta = "suspender" | "excluir";

export function recusaDeAcaoNaConta(p: {
  acao: AcaoNaConta;
  atorId: string;
  alvoId: string;
  alvoEhPlatformAdmin: boolean;
  platformAdminsAtivos: number;
  alvoJaSuspenso?: boolean;
}): Recusa | null {
  if (p.atorId === p.alvoId) {
    return {
      motivo: "propria_conta",
      message:
        p.acao === "suspender"
          ? "Não é possível suspender a própria conta."
          : "Não é possível excluir a própria conta.",
    };
  }
  if (p.alvoEhPlatformAdmin && p.platformAdminsAtivos <= 1) {
    return {
      motivo: "ultimo_admin",
      message: "Esta é a última conta de administração da plataforma.",
    };
  }
  if (p.acao === "suspender" && p.alvoJaSuspenso) {
    return { motivo: "estado", message: "Esta conta já está suspensa." };
  }
  return null;
}

/**
 * Mudança num vínculo com organização. `papelNovo = null` é REMOVER da org.
 */
export function recusaDeMudancaNoVinculo(p: {
  papelAtual: Role;
  papelNovo: Role | null;
  revogado: boolean;
  adminsAtivosNaOrg: number;
}): Recusa | null {
  if (p.revogado) {
    return { motivo: "estado", message: "Esta pessoa já não faz parte da organização." };
  }
  const deixaDeSerAdmin = p.papelAtual === "admin" && p.papelNovo !== "admin";
  if (deixaDeSerAdmin && p.adminsAtivosNaOrg <= 1) {
    return {
      motivo: "ultimo_admin",
      message:
        p.papelNovo === null
          ? "Não é possível remover o último administrador da organização."
          : "Não é possível rebaixar o último administrador da organização.",
    };
  }
  return null;
}

/** Hash curto de e-mail para metadado de audit — nunca o e-mail cru. */
export function hashDeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  return Buffer.from(email.toLowerCase()).toString("hex").slice(0, 12) + "...";
}
