/**
 * /app/ai/agents/criar-com-ia — "Criar agente com IA".
 *
 * Server component: resolve o que só o servidor sabe — os números de WhatsApp
 * da organização e o mapa pacote → ferramentas (o catálogo com handler é
 * server-side). O resto é o cliente.
 *
 * Porta: botão "Criar com IA" na lista de Agentes (allowlist de
 * `tests/unit/navegacao-completude.test.ts`, mesmo argumento de `/new`).
 * Papel: admin, o mesmo de criar agente pela tela ou pela API.
 */
import { redirect } from "next/navigation";

import { capacidadesPorPacote } from "@/lib/ai/agents/capacidades-padrao";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { listSelectableChannels } from "@/lib/channels/selectable";
import { createClient } from "@/lib/supabase/server";

import { CriarComIa } from "./_client";

export const dynamic = "force-dynamic";

export default async function CriarAgenteComIaPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) redirect("/403");

  const supabase = await createClient();
  const canais = (await listSelectableChannels(supabase, activeOrg.orgId)).map((c) => ({
    id: c.id,
    rotulo: c.phone_number ? `${c.display_name} · ${c.phone_number}` : c.display_name,
  }));

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <CriarComIa canais={canais} mapa={capacidadesPorPacote()} />
    </div>
  );
}
