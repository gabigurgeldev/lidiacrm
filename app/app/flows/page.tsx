import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";

import { FluxosClient } from "./_client";

export const dynamic = "force-dynamic";

export default async function FluxosPage() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  // Montar um fluxo é montar algo que fala com cliente e mexe no funil sozinho.
  const podeGerenciar = !!org && ROLE_RANK[org.role] >= ROLE_RANK.manager;
  if (!podeGerenciar) redirect("/app/inbox");

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {traduzir("Fluxos", user.idioma)}
        </h1>
        <p className="text-sm text-muted-foreground">
          {traduzir(
            "Monte no quadro o que o sistema faz sozinho: distribuir, avisar, esperar e cobrar.",
            user.idioma,
          )}
        </p>
      </header>
      <FluxosClient />
    </div>
  );
}
