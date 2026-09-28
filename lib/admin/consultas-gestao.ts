/**
 * Consultas que as rotas de gestão de usuários do painel fazem ANTES de agir —
 * o lado de I/O das regras puras de `./gestao-usuarios.ts`.
 *
 * Service role de propósito: o painel da plataforma age sobre qualquer
 * organização, e o alvo (usuário e organização) vem sempre do PATH, nunca do
 * body (CLAUDE.md, anti-pattern 10).
 */
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface SituacaoDePlataforma {
  alvoEhPlatformAdmin: boolean;
  platformAdminsAtivos: number;
}

export async function situacaoDePlataforma(
  admin: AdminClient,
  alvoId: string,
): Promise<SituacaoDePlataforma | { erro: string }> {
  const { data, error } = await admin
    .from("platform_admins")
    .select("user_id")
    .is("revoked_at", null);
  if (error) return { erro: error.message };
  const ids = (data ?? []).map((r) => r.user_id);
  return { alvoEhPlatformAdmin: ids.includes(alvoId), platformAdminsAtivos: ids.length };
}

export async function adminsAtivosDaOrg(
  admin: AdminClient,
  organizationId: string,
): Promise<number | { erro: string }> {
  const { count, error } = await admin
    .from("user_organizations")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("role", "admin")
    .is("revoked_at", null);
  if (error) return { erro: error.message };
  return count ?? 0;
}

/**
 * Organizações em que o alvo é o ÚNICO admin ativo. Excluir a conta dele
 * deixaria cada uma delas sem ninguém capaz de gerir a própria equipe.
 */
export async function orgsOndeEhUltimoAdmin(
  admin: AdminClient,
  alvoId: string,
): Promise<Array<{ organization_id: string; nome: string | null }> | { erro: string }> {
  const { data, error } = await admin
    .from("user_organizations")
    .select("organization_id, organizations(display_name)")
    .eq("user_id", alvoId)
    .eq("role", "admin")
    .is("revoked_at", null);
  if (error) return { erro: error.message };

  const presas: Array<{ organization_id: string; nome: string | null }> = [];
  for (const v of (data ?? []) as unknown as Array<{
    organization_id: string;
    organizations: { display_name: string } | null;
  }>) {
    const n = await adminsAtivosDaOrg(admin, v.organization_id);
    if (typeof n !== "number") return n;
    if (n <= 1) {
      presas.push({ organization_id: v.organization_id, nome: v.organizations?.display_name ?? null });
    }
  }
  return presas;
}

/**
 * Todos os vínculos da instalação, com o nome da organização, em páginas.
 *
 * Paginado com `.range()` porque o PostgREST corta a resposta no `max_rows`
 * (1000 no Supabase padrão) SEM avisar: um relatório lido numa página só
 * contaria no máximo mil vínculos numa instalação que tem mais, e o número
 * sairia plausível.
 */
export async function todosOsVinculos(
  admin: AdminClient,
): Promise<
  | Array<{
      user_id: string;
      organization_id: string;
      organization_name: string | null;
      role: string;
      revoked_at: string | null;
    }>
  | { erro: string }
> {
  const PAGINA = 1000;
  const saida: Array<{
    user_id: string;
    organization_id: string;
    organization_name: string | null;
    role: string;
    revoked_at: string | null;
  }> = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await admin
      .from("user_organizations")
      .select("id, user_id, organization_id, role, revoked_at, organizations(display_name)")
      .order("id", { ascending: true })
      .range(de, de + PAGINA - 1);
    if (error) return { erro: error.message };
    const lote = (data ?? []) as unknown as Array<{
      user_id: string;
      organization_id: string;
      role: string;
      revoked_at: string | null;
      organizations: { display_name: string } | null;
    }>;
    for (const v of lote) {
      saida.push({
        user_id: v.user_id,
        organization_id: v.organization_id,
        organization_name: v.organizations?.display_name ?? null,
        role: v.role,
        revoked_at: v.revoked_at,
      });
    }
    if (lote.length < PAGINA) break;
  }
  return saida;
}
