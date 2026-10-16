import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { AgentInboxList } from "./_components/AgentInboxList";
import { PaginaAjustes } from "@/components/ajustes";

export const dynamic = "force-dynamic";

export default async function AgentInboxPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  const canResolve = ROLE_RANK[activeOrg.role] >= ROLE_RANK.agent;
  // Ensinar o agente (Central de lacunas) é o gate humano da base: manager+.
  const canTeach = ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager;
  const idioma = user.idioma;

  return (
    <PaginaAjustes
      titulo={traduzir("Central de avisos", idioma)}
      descricao={traduzir(
        "O que o assistente precisou escalar para o time: conexões caídas, tarefas que falharam, atendimentos passados a humanos.",
        idioma,
      )}
    >
      <AgentInboxList canResolve={canResolve} canTeach={canTeach} />
    </PaginaAjustes>
  );
}
