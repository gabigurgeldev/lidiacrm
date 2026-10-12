/**
 * /app/ai/agents/criar-com-ia — o assistente de agentes: criar um agente novo
 * ou corrigir um que já existe (`?modo=corrigir&agente=<id>`).
 *
 * Server component: resolve o que só o servidor sabe — os números de WhatsApp
 * da organização, os agentes que dá para corrigir e o mapa pacote → ferramentas
 * (o catálogo com handler é server-side). O resto é o cliente.
 *
 * Portas: botão "Criar com IA" na lista de Agentes e "Corrigir com IA" no
 * editor do agente (allowlist de `tests/unit/navegacao-completude.test.ts`,
 * mesmo argumento de `/new`).
 * Papel: admin, o mesmo de criar agente pela tela ou pela API.
 */
import { redirect } from "next/navigation";

import { PaginaAjustes } from "@/components/ajustes";
import { traduzir } from "@/lib/i18n/dicionario";
import { capacidadesPorPacote } from "@/lib/ai/agents/capacidades-padrao";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { listSelectableChannels } from "@/lib/channels/selectable";
import { createClient } from "@/lib/supabase/server";

import { Assistente } from "./_components/Assistente";

export const dynamic = "force-dynamic";

export default async function CriarAgenteComIaPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) redirect("/403");

  const supabase = await createClient();
  const [selecionaveis, { data: agentesDaOrg }] = await Promise.all([
    listSelectableChannels(supabase, activeOrg.orgId),
    // Só os do editor atual: o agente antigo (sem versão) não tem o que corrigir.
    supabase
      .from("ai_agents")
      .select("id, name")
      .eq("organization_id", activeOrg.orgId)
      .eq("kind", "mcp_agent")
      .is("archived_at", null)
      .order("name", { ascending: true }),
  ]);
  const canais = selecionaveis.map((c) => ({
    id: c.id,
    rotulo: c.phone_number ? `${c.display_name} · ${c.phone_number}` : c.display_name,
  }));
  const agentes = ((agentesDaOrg ?? []) as Array<{ id: string; name: string }>).map((a) => ({ id: a.id, nome: a.name }));

  return (
    <PaginaAjustes
      className="mx-auto w-full max-w-6xl"
      testid="pagina-criar-com-ia"
      titulo={traduzir("Assistente de agentes", user.idioma)}
      descricao={traduzir(
        "Crie um agente conversando com a IA, ou relate um problema de um agente que já existe e ela propõe a correção. Nada é gravado antes do seu clique, e nada vai ao ar sem você publicar.",
        user.idioma,
      )}
    >
      <Assistente canais={canais} mapa={capacidadesPorPacote()} agentes={agentes} />
    </PaginaAjustes>
  );
}
