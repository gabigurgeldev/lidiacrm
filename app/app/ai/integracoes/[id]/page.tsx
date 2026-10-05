import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { COLUNAS_DA_INTEGRACAO, COLUNAS_DO_ENDPOINT, type EndpointRow, type IntegracaoRow } from "@/lib/ai/integracoes/servidor";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";
import { ArrowLeft } from "@/lib/ui/icons";

import { PainelDaIntegracao } from "./_components/PainelDaIntegracao";

export const dynamic = "force-dynamic";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function IntegracaoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RX.test(id)) notFound();
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) redirect("/403");

  const supabase = await createClient();
  const [integracaoRes, endpointsRes] = await Promise.all([
    supabase
      .from("ai_api_integrations")
      .select(COLUNAS_DA_INTEGRACAO)
      .eq("organization_id", activeOrg.orgId)
      .eq("id", id)
      .is("arquivada_em", null)
      .maybeSingle(),
    supabase
      .from("ai_api_endpoints")
      .select(COLUNAS_DO_ENDPOINT)
      .eq("organization_id", activeOrg.orgId)
      .eq("integration_id", id)
      .order("slug", { ascending: true }),
  ]);
  if (!integracaoRes.data) notFound();

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <Link href="/app/ai/integracoes" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft size={14} aria-hidden /> {traduzir("Integrações via API", user.idioma)}
      </Link>
      <PainelDaIntegracao
        integracao={integracaoRes.data as unknown as IntegracaoRow}
        endpoints={(endpointsRes.data ?? []) as unknown as EndpointRow[]}
        podeEscrever={ROLE_RANK[activeOrg.role] >= ROLE_RANK.admin}
      />
    </div>
  );
}
