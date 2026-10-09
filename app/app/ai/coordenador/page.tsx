import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { lerPainel } from "@/lib/coordenador/painel";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";

import { CoordenadorClient } from "./_client";
import { PaginaAjustes } from "@/components/ajustes";

export const dynamic = "force-dynamic";

export default async function CoordenadorPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  const idioma = user.idioma;

  if (!user.is_platform_admin && ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    redirect("/403");
  }

  // Cliente admin com a org da SESSÃO: as tabelas do coordenador são de leitura
  // para o membro, mas o painel cruza agentes, fluxos e versões de uma vez.
  const painel = await lerPainel(createAdminClient(), activeOrg.orgId);
  const podePublicar = user.is_platform_admin || ROLE_RANK[activeOrg.role] >= ROLE_RANK.admin;

  return (
    <PaginaAjustes
      titulo={traduzir("Coordenador de atendimento", idioma)}
      descricao={traduzir(
        "Decide quem conduz cada conversa — um agente, um fluxo ou a equipe — para o cliente nunca ouvir duas vozes ao mesmo tempo.",
        idioma,
      )}
    >
      <CoordenadorClient painelInicial={painel} podePublicar={podePublicar} />
    </PaginaAjustes>
  );
}
