import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { DisparosClient } from "./_components/DisparosClient";

export const dynamic = "force-dynamic";

export default async function DisparosPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app/inbox");

  // Ver é `viewer`; criar e disparar é `manager`. A tela mostra a lista para
  // quem só olha e esconde os botões — em vez de esconder a tela inteira, que
  // faria a pessoa não saber que a campanha existiu.
  const podeDisparar = ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager;
  const t = (texto: string) => traduzir(texto, user.idioma);

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Disparo em massa")}</h1>
        <p className="text-sm text-muted-foreground">
          {t(
            "Fale com uma lista de contatos pelo WhatsApp, no ritmo que o número aguenta — e veja, pessoa a pessoa, o que saiu e o que não saiu.",
          )}
        </p>
      </header>
      <DisparosClient podeDisparar={podeDisparar} />
    </div>
  );
}
