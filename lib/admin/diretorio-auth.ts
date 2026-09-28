/**
 * Varredura do diretório do Supabase Auth (GoTrue) para o painel da plataforma.
 *
 * Extraída de `app/api/v1/admin/users/route.ts`, onde nasceu, porque três rotas
 * passaram a precisar dela: a listagem, o relatório e o export CSV. Três cópias
 * de um laço com teto, parada por página vazia e tratamento de erro do GoTrue
 * divergiriam no primeiro ajuste — e o ajuste que divergisse seria justamente o
 * do teto, que é o que impede a lista de sair truncada em silêncio.
 *
 * Por que `listUsers` paginado e não `getUserById` por vínculo: o fan-out
 * custava um request HTTP por vínculo, todos concorrentes. Medido na revisão do
 * PR que trocou, em localhost com 300 vínculos: 214 respostas 504 em 12,2s.
 *
 * Por que NÃO `nextPage`: o auth-js o deriva do header Link com
 * `.substring(0, 1)` (`GoTrueAdminApi.listUsers`, @supabase/auth-js 2.111.0),
 * então da página 10 em diante ele lê "1" e a varredura andaria para trás. A
 * parada é a primeira página VAZIA.
 */
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface UsuarioDoDiretorio {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  last_sign_in_at: string | null;
  created_at: string;
  email_confirmed_at: string | null;
  banned_until: string | null;
  /** Há pelo menos um fator MFA verificado. */
  tem_mfa: boolean;
}

export const POR_PAGINA = 1000;
/**
 * Teto defensivo. A condição de falha é "a página MAX_PAGINAS veio NÃO-VAZIA e
 * ainda falta id", que NÃO é o mesmo que "o diretório é maior que
 * MAX_PAGINAS × POR_PAGINA": um vínculo órfão num diretório com exatamente esse
 * número de páginas cai aqui igual. Sem como distinguir, falha alto — entregar
 * a lista como se estivesse completa é o erro caro.
 */
export const MAX_PAGINAS = 50;

export type ResultadoDaVarredura =
  | { ok: true; usuarios: Map<string, UsuarioDoDiretorio> }
  | { ok: false; motivo: "auth_indisponivel" | "teto_atingido"; detalhe: string };

/** Projeção de um usuário do GoTrue para o formato que o painel consome. */
export function projetarUsuario(u: {
  id: string;
  email?: string | null;
  phone?: string | null;
  last_sign_in_at?: string | null;
  created_at: string;
  email_confirmed_at?: string | null;
  banned_until?: string | null;
  user_metadata?: Record<string, unknown> | null;
  factors?: Array<{ status: string }> | null;
}): UsuarioDoDiretorio {
  const meta = (u.user_metadata ?? null) as Record<string, unknown> | null;
  const nome = meta?.full_name;
  return {
    id: u.id,
    email: u.email ?? null,
    full_name: typeof nome === "string" && nome.trim() ? nome : null,
    phone: u.phone ? u.phone : null,
    last_sign_in_at: u.last_sign_in_at ?? null,
    created_at: u.created_at,
    email_confirmed_at: u.email_confirmed_at ?? null,
    banned_until: u.banned_until ?? null,
    tem_mfa: (u.factors ?? []).some((f) => f.status === "verified"),
  };
}

/**
 * Varre o diretório.
 *
 * - `necessarios` presente: para assim que todos os ids apareceram (listagem).
 * - `necessarios` ausente: lê o diretório inteiro (relatório).
 *
 * Usuários excluídos (soft delete do GoTrue, `deleted_at` preenchido) nunca
 * entram no resultado.
 */
export async function varrerDiretorio(
  admin: AdminClient,
  necessarios?: Set<string>,
): Promise<ResultadoDaVarredura> {
  const usuarios = new Map<string, UsuarioDoDiretorio>();
  let pagina = 1;

  const completo = () => necessarios !== undefined && usuarios.size >= necessarios.size;

  while (!completo()) {
    const res = await admin.auth.admin.listUsers({ page: pagina, perPage: POR_PAGINA });

    if (res.error) {
      // O GoTrue devolve AuthRetryableFetchError SEM lançar em 504/500/socket
      // fechado. Tratar isso como "usuário não existe" transformaria
      // indisponibilidade em lista vazia — indistinguível de banco vazio.
      return { ok: false, motivo: "auth_indisponivel", detalhe: res.error.message };
    }

    const lote = res.data.users;
    for (const u of lote) {
      if ((u as { deleted_at?: string | null }).deleted_at) continue;
      if (necessarios && !necessarios.has(u.id)) continue;
      usuarios.set(
        u.id,
        projetarUsuario(u as unknown as Parameters<typeof projetarUsuario>[0]),
      );
    }

    if (lote.length === 0) break;

    if (pagina >= MAX_PAGINAS) {
      // Sem `necessarios` (relatório), qualquer página cheia no teto significa
      // que pode haver mais — e um relatório que conta menos do que existe é
      // pior que um relatório que diz que não conseguiu contar.
      if (!necessarios || !completo()) {
        const pendentes = necessarios ? necessarios.size - usuarios.size : null;
        return {
          ok: false,
          motivo: "teto_atingido",
          detalhe:
            pendentes === null
              ? `scanned ${MAX_PAGINAS} pages of ${POR_PAGINA}; directory not exhausted`
              : `scanned ${MAX_PAGINAS} pages of ${POR_PAGINA}; ${pendentes} of ${necessarios!.size} link(s) unresolved`,
        };
      }
    }
    pagina += 1;
  }

  return { ok: true, usuarios };
}
