import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { BudgetCard } from "@/components/ai/BudgetCard";
import { getBudgetStatus } from "@/lib/ai/budget/check";
import { traduzir } from "@/lib/i18n/dicionario";
import { UsageDashboardClient } from "./_client";
import { PaginaAjustes } from "@/components/ajustes";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function singleParam(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

export default async function AiUsagePage({ searchParams }: PageProps) {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    redirect("/403");
  }

  const supabase = await createClient();
  const { data: agentRows } = await supabase
    .from("ai_agents")
    .select("id, name, is_default")
    .eq("organization_id", activeOrg.orgId)
    .order("is_default", { ascending: false })
    .order("name", { ascending: true });

  const agents = (agentRows ?? []).map(
    (a: { id: string; name: string; is_default?: boolean | null }) => ({
      id: a.id,
      name: a.name,
    }),
  );

  const sp = await searchParams;
  const initial = {
    agent_id: singleParam(sp.agent_id),
    invocation_kind: singleParam(sp.invocation_kind),
    from: singleParam(sp.from),
    to: singleParam(sp.to),
  };

  const budget = await getBudgetStatus(activeOrg.orgId);
  const isAdmin = ROLE_RANK[activeOrg.role] >= ROLE_RANK.admin;
  const idioma = user.idioma;

  return (
    <PaginaAjustes
      titulo={traduzir("Uso de IA", idioma)}
      descricao={traduzir(
        "Quanto a inteligência artificial custou, quantos atendimentos ela fez, quanto demorou para responder e quantas vezes precisou chamar uma pessoa — nos últimos 30 dias.",
        idioma,
      )}
    >
      <BudgetCard initialData={budget} isAdmin={isAdmin} />
      <UsageDashboardClient agents={agents} initial={initial} />
    </PaginaAjustes>
  );
}
