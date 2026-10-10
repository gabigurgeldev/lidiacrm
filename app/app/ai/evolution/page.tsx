import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { EvolutionClient } from "./_client";
import { PaginaAjustes } from "@/components/ajustes";

export const dynamic = "force-dynamic";

/**
 * O intervalo padrão nasce AQUI, no servidor, e desce como prop. Calculá-lo no
 * cliente com `new Date()` faria o render do servidor e o da hidratação
 * discordarem na virada do dia UTC — o campo de data piscaria trocando sozinho.
 * São os mesmos 30 dias que a rota assume quando não recebe filtro.
 */
function ultimosTrintaDiasUtc(): { from: string; to: string } {
  const agora = new Date();
  const fim = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate()));
  const inicio = new Date(fim.getTime() - 29 * 86_400_000);
  return { from: inicio.toISOString().slice(0, 10), to: fim.toISOString().slice(0, 10) };
}

export default async function EvolutionPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  if (!user.is_platform_admin && ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    redirect("/403");
  }
  const idioma = user.idioma;

  return (
    <PaginaAjustes
      titulo={traduzir("Evolução da IA", idioma)}
      descricao={traduzir(
        "O que seu agente aprendeu no período, o que ele fez com isso, o que mudou no seu resultado — e o que ainda está travando.",
        idioma,
      )}
    >
      <EvolutionClient defaultRange={ultimosTrintaDiasUtc()} />
    </PaginaAjustes>
  );
}
