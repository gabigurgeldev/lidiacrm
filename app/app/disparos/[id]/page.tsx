import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { DisparoDetalhe } from "./_components/DisparoDetalhe";

export const dynamic = "force-dynamic";

export default async function DisparoPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app/inbox");
  const { id } = await params;

  return (
    <DisparoDetalhe
      id={id}
      podeDisparar={ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager}
    />
  );
}
