import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { lerConfigDeAniversario } from "@/lib/schemas/aniversario";
import { createClient } from "@/lib/supabase/server";

import { AniversarioForm } from "./_form";

export const dynamic = "force-dynamic";

/**
 * Configurações › Aniversários — liga a mensagem de parabéns automática.
 * Gestor para cima, como a distribuição de atendimento: é uma decisão que fala
 * com TODA a base de clientes da empresa.
 */
export default async function AniversarioSettingsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (!user.is_platform_admin && ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    redirect("/403");
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("organizations")
    .select("settings")
    .eq("id", activeOrg.orgId)
    .maybeSingle();
  const idioma = user.idioma;

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{traduzir("Aniversários", idioma)}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {traduzir(
            "No dia do aniversário de cada cliente, o sistema manda sozinho uma mensagem de parabéns pelo WhatsApp. A data vem do cadastro do contato (campo Data de nascimento, ou a coluna da planilha de importação).",
            idioma,
          )}
        </p>
      </header>

      <AniversarioForm initial={lerConfigDeAniversario(data?.settings)} />
    </div>
  );
}
