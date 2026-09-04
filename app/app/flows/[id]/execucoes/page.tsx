import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";

import { ExecucoesDoFluxoClient } from "./_client";

/**
 * As execuções DESTE fluxo, ao vivo.
 *
 * ─── Por que sob `[id]`, e não uma rota estática ────────────────────────────
 *
 * `tests/unit/navegacao-completude.test.ts` pula segmentos `[...]` porque tela
 * de detalhe é alcançada a partir de uma lista, nunca de um item de menu — e é
 * exatamente o caso: a porta é o link na tela do próprio fluxo, que é onde a
 * pessoa está quando quer ver rodar. A tela GLOBAL de execuções continua onde
 * estava, no hub do grupo.
 */
export const dynamic = "force-dynamic";

export default async function ExecucoesDoFluxoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  const podeGerenciar = !!org && ROLE_RANK[org.role] >= ROLE_RANK.manager;
  if (!podeGerenciar) redirect("/app/inbox");

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {traduzir("Execuções deste fluxo", user.idioma)}
        </h1>
        <p className="text-sm text-muted-foreground">
          {traduzir(
            "Quem disparou, em que passo está e quanto tempo levou entre um passo e outro.",
            user.idioma,
          )}
        </p>
      </header>
      <ExecucoesDoFluxoClient flowId={id} />
    </div>
  );
}
