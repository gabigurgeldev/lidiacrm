import { redirect } from "next/navigation";

import { Kanban } from "@/lib/ui/icons";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { formatarReais } from "@/lib/kanban/dinheiro";
import { FunisClient, type FunilDaLista, type ResumoDoKanban } from "./_client";

export const dynamic = "force-dynamic";

/**
 * A lista de funis — e o lugar onde eles se gerenciam.
 *
 * ⚠️ O FILTRO DE `organization_id` NÃO É REDUNDANTE COM A RLS, e a falta dele era
 * um bug visível: a policy `crm_pipelines_select` libera TODAS as organizações do
 * usuário (`organization_id in fn_user_org_ids()`) e libera tudo para
 * `fn_is_platform_admin()`. Quem participa de duas organizações via as duas
 * listas misturadas — e como o gatilho `trg_seed_default_pipeline_for_org` semeia
 * um funil "Pedidos" em toda organização nova, a tela mostrava várias linhas
 * idênticas, indistinguíveis, cada uma levando a um quadro diferente. A RLS
 * responde "pode ver?"; a tela precisa responder "quer ver agora?".
 *
 * ⚠️ A LEITURA É ABERTA, A ESCRITA É manager+. Ver a lista e abrir o quadro é
 * trabalho de qualquer papel; criar, renomear, reordenar e arquivar é
 * configuração — e é o que `requireRole("manager")` cobra nas rotas.
 * `podeGerenciar` usa o MESMO critério delas (o papel na organização ativa, sem
 * atalho de platform admin, que as rotas não concedem por padrão): mostrar um
 * botão que o servidor recusaria seria prometer o que não se cumpre.
 */
export default async function KanbanPickerPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  const supabase = await createClient();
  // Três leituras em paralelo, todas com a organização ATIVA filtrada à mão (a
  // RLS libera todas as organizações do usuário — ver o comentário acima).
  // Os negócios vêm só com o necessário para contar e somar: pipeline, coluna e
  // valor dos ABERTOS. Fechado não entra no retrato de "o que está andando".
  const [{ data }, { data: colunas }, { data: abertos }] = await Promise.all([
    supabase
      .from("crm_pipelines")
      .select("id, name, slug, description, position, is_default")
      .eq("organization_id", activeOrg.orgId)
      .eq("is_archived", false)
      .order("position"),
    supabase
      .from("crm_stages")
      .select("id, name, color, pipeline_id, position")
      .eq("organization_id", activeOrg.orgId)
      .eq("is_archived", false)
      .order("position"),
    supabase
      .from("crm_leads")
      .select("pipeline_id, stage_id, value_cents")
      .eq("organization_id", activeOrg.orgId)
      .eq("status", "open"),
  ]);

  const funis = (data ?? []) as FunilDaLista[];
  const porColuna = new Map<string, number>();
  const resumo: Record<string, ResumoDoKanban> = {};
  for (const f of funis) resumo[f.id] = { abertos: 0, valorCents: 0, colunas: [] };
  for (const l of (abertos ?? []) as Array<{ pipeline_id: string; stage_id: string; value_cents: number | null }>) {
    const r = resumo[l.pipeline_id];
    if (!r) continue;
    r.abertos += 1;
    r.valorCents += l.value_cents ?? 0;
    porColuna.set(l.stage_id, (porColuna.get(l.stage_id) ?? 0) + 1);
  }
  for (const c of (colunas ?? []) as Array<{ id: string; name: string; color: string | null; pipeline_id: string }>) {
    resumo[c.pipeline_id]?.colunas.push({
      id: c.id,
      name: c.name,
      color: c.color,
      abertos: porColuna.get(c.id) ?? 0,
    });
  }
  const totalAbertos = Object.values(resumo).reduce((s, r) => s + r.abertos, 0);
  const totalValor = Object.values(resumo).reduce((s, r) => s + r.valorCents, 0);
  const podeGerenciar = ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager;
  const idioma = user.idioma;
  const t = (texto: string) => traduzir(texto, idioma);

  return (
    <div className="flex h-full flex-col gap-5 p-4 sm:p-6">
      {/* Chassi em vidro: o cabeçalho é a única superfície translúcida da tela
          (docs/design-system/09-anti-patterns.md — vidro só em chassi). */}
      <header className="ios-vidro sticky top-0 z-20 -mx-4 -mt-4 flex flex-wrap items-center gap-3 border-b border-border px-4 py-4 sm:-mx-6 sm:-mt-6 sm:px-6">
        <span className="flex size-11 items-center justify-center rounded-ios bg-accent-soft text-accent">
          <Kanban size={24} weight="duotone" />
        </span>
        {/* Era "Pipelines" — nome de quem construiu o sistema, não de quem
            vende. O comentário anterior aqui listava o preço de trocá-lo
            (`rbac-roles.spec.ts` e `invite-lifecycle.spec.ts`) e dizia que
            uniformizar era decisão do dono do produto. Ela foi tomada, e o preço
            era maior do que o comentário contava: são QUATRO assertions em TRÊS
            specs, e `pipelines-gestao.spec.ts` — a spec da própria feature que
            gerou o comentário — é uma delas. Todas atualizadas junto. */}
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t("Kanbans")}</h1>
          <p className="text-sm text-text-muted">
            {totalAbertos} {totalAbertos === 1 ? t("negócio aberto") : t("negócios abertos")} ·{" "}
            {formatarReais(totalValor)} {t("em aberto")}
          </p>
        </div>
      </header>

      <FunisClient funis={funis} resumo={resumo} podeGerenciar={podeGerenciar} />
    </div>
  );
}
