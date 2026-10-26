import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";
import { Tag } from "@/lib/ui/icons";
import { TagsClient, type KanbanDaTela } from "./_client";

export const dynamic = "force-dynamic";

/**
 * O catálogo de tags (migration 0248) — onde as tags NASCEM.
 *
 * Antes uma tag era o que alguém digitava num contato; "VIP", "vip" e "Vip "
 * viravam três. Aqui a tag ganha nome, cor e, se quiser, uma coluna de Kanban:
 * aplicá-la num contato leva o negócio dele para lá.
 *
 * Ler é de todo papel (o atendente precisa saber o que cada tag significa);
 * criar, editar e arquivar é manager+, o mesmo `requireRole` das rotas.
 */
export default async function TagsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  const podeGerenciar = ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager;
  const t = (texto: string) => traduzir(texto, user.idioma);

  // Os Kanbans e as colunas para o seletor "Coluna do Kanban" do diálogo. O
  // filtro de organização NÃO é redundante com a RLS: ela libera todas as
  // organizações do usuário (ver o comentário de app/app/kanban/page.tsx).
  let kanbans: KanbanDaTela[] = [];
  if (podeGerenciar) {
    const supabase = await createClient();
    const [{ data: pipelines }, { data: stages }] = await Promise.all([
      supabase
        .from("crm_pipelines")
        .select("id, name")
        .eq("organization_id", activeOrg.orgId)
        .eq("is_archived", false)
        .order("position"),
      supabase
        .from("crm_stages")
        .select("id, name, pipeline_id")
        .eq("organization_id", activeOrg.orgId)
        .eq("is_archived", false)
        .order("position"),
    ]);
    kanbans = (pipelines ?? []).map((p) => ({
      id: p.id as string,
      name: p.name as string,
      colunas: (stages ?? [])
        .filter((s) => s.pipeline_id === p.id)
        .map((s) => ({ id: s.id as string, name: s.name as string })),
    }));
  }

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <Tag size={28} className="text-muted-foreground" weight="duotone" />
          <h1 className="text-2xl font-semibold tracking-tight">{t("Tags")}</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {t(
            "Crie as tags da empresa, dê uma cor a cada uma e, se quiser, ligue a tag a uma coluna do Kanban: aplicá-la num contato leva o negócio dele para lá.",
          )}
        </p>
      </header>

      <TagsClient podeGerenciar={podeGerenciar} kanbans={kanbans} />
    </div>
  );
}
