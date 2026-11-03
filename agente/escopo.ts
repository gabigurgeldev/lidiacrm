/**
 * O ESCOPO de uma pergunta à assistente — de onde vem, e o que ele recorta.
 *
 * ── Vem SÓ da sessão ────────────────────────────────────────────────────────
 *
 * Organização, usuário e papel saem de `loadAuthUser` + `resolveActiveOrg`
 * (`lib/auth/server.ts`), que escolhem a organização ativa ENTRE AS MEMBERSHIPS
 * da pessoa (`user_organizations`, `revoked_at is null`). Ser platform admin não
 * entra nessa conta: quem administra a plataforma e não é membro de nenhuma
 * organização não ganha escopo nenhum aqui — a rota responde sem organização.
 *
 * Nenhuma ferramenta recebe organização ou usuário do MODELO. O que o modelo
 * manda vira, no máximo, um nome a procurar ou um período; o recorte é sempre
 * este objeto.
 *
 * ── Por que o filtro explícito, se a RLS existe ─────────────────────────────
 *
 * A RLS deste repo deixa o platform admin ver toda organização
 * (`fn_is_platform_admin()` em quase toda policy). Um platform admin que é
 * também membro de uma organização, perguntando à assistente, receberia pela
 * RLS as linhas de TODAS — por isso toda consulta das ferramentas leva
 * `.eq("organization_id", escopo.organizationId)`, e a visibilidade por pessoa
 * (inbox e funil) é reaplicada aqui com a mesma regra de
 * `fn_can_view_conversation`/`fn_can_view_lead`, que o bypass de admin pularia.
 */
import { roleAtLeast, type Role, type VisibilityMode } from "@/lib/auth/types";

export interface EscopoDoAgente {
  organizationId: string;
  userId: string;
  role: Role;
  /** `organizations.settings.visibility_mode` — quem o agent enxerga no inbox e no funil. */
  visibilityMode: VisibilityMode;
  /** Fuso para "hoje", "esta semana" e para escrever horários. */
  fuso: string;
}

export function papelAoMenos(escopo: EscopoDoAgente, minimo: Role): boolean {
  return roleAtLeast(escopo.role, minimo);
}

export type RecorteDeVisibilidade = "tudo" | "so_meus" | "meus_e_sem_dono";

/**
 * A mesma regra de `fn_can_view_conversation` (e de `fn_can_view_lead`), SEM o
 * ramo do platform admin: viewer, manager e admin veem a organização inteira;
 * o agent vê o que é dele e, conforme a organização configurou, o que está sem
 * dono ou tudo.
 */
export function recorteDeVisibilidade(escopo: EscopoDoAgente): RecorteDeVisibilidade {
  if (escopo.role !== "agent") return "tudo";
  switch (escopo.visibilityMode) {
    case "all":
      return "tudo";
    case "own":
      return "so_meus";
    default:
      return "meus_e_sem_dono";
  }
}

/** Frase curta para a assistente explicar POR QUE o número é o que é. */
export function descricaoDoRecorte(recorte: RecorteDeVisibilidade): string {
  switch (recorte) {
    case "tudo":
      return "todos os da organização";
    case "so_meus":
      return "só os atribuídos a você";
    case "meus_e_sem_dono":
      return "os atribuídos a você e os sem responsável";
  }
}

/**
 * Aplica o recorte numa consulta do PostgREST. `coluna` é a coluna de dono
 * (`assigned_to_user_id` na conversa, `owner_user_id` no lead). O `userId` vem
 * da sessão — é um uuid validado pelo GoTrue, nunca texto do modelo, por isso
 * pode entrar na string do `.or()`.
 */
export function aplicarRecorte<Q>(query: Q, coluna: string, escopo: EscopoDoAgente): Q {
  // O builder do PostgREST devolve `this` em `eq`/`or`. Tipar isso pelo
  // genérico do supabase-js estoura o compilador (TS2589), então a forma
  // mínima é declarada aqui e o tipo de entrada volta intacto.
  const q = query as unknown as RecortavelPorDono;
  const recorte = recorteDeVisibilidade(escopo);
  if (recorte === "so_meus") return q.eq(coluna, escopo.userId) as Q;
  if (recorte === "meus_e_sem_dono") {
    return q.or(`${coluna}.eq.${escopo.userId},${coluna}.is.null`) as Q;
  }
  return query;
}

interface RecortavelPorDono {
  eq(coluna: string, valor: string): unknown;
  or(filtro: string): unknown;
}
