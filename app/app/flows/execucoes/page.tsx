import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";

import { ExecucoesClient } from "./_client";

export const dynamic = "force-dynamic";

export default async function ExecucoesPage() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  const podeGerenciar = !!org && ROLE_RANK[org.role] >= ROLE_RANK.manager;
  if (!podeGerenciar) redirect("/app/inbox");

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {traduzir("Execuções", user.idioma)}
        </h1>
        <p className="text-sm text-muted-foreground">
          {traduzir(
            "O que os seus fluxos fizeram, passo a passo — e o que parou no meio.",
            user.idioma,
          )}
        </p>
      </header>
      <ExecucoesClient />
    </div>
  );
}
