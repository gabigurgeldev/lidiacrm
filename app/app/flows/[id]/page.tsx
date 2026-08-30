import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";

import { FlowBuilder } from "./_components/FlowBuilder";

export const dynamic = "force-dynamic";

export default async function ConstrutorDeFluxoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  const podeGerenciar = !!org && ROLE_RANK[org.role] >= ROLE_RANK.manager;
  if (!podeGerenciar) redirect("/app/inbox");
  const { id } = await params;

  return <FlowBuilder flowId={id} />;
}
