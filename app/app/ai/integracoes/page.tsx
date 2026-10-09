import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { COLUNAS_DA_INTEGRACAO } from "@/lib/ai/integracoes/servidor";
import { chaveDeCifragemUtilizavel } from "@/lib/crypto/aes_gcm";
import { isEmailConfigured } from "@/lib/email/resend";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";

import { ListaDeIntegracoes, type IntegracaoDaLista } from "./_components/ListaDeIntegracoes";
import { PaginaAjustes } from "@/components/ajustes";

export const dynamic = "force-dynamic";

/**
 * Central de IA › Integrações via API (migration 0223).
 *
 * Os dois avisos do topo são o que faria o recurso parecer configurado e não
 * funcionar: sem chave de cifra não há onde guardar o segredo da API, e sem
 * e-mail o agente não consegue verificar quem é o dono de uma conta.
 */
export default async function IntegracoesPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) redirect("/403");
  const idioma = user.idioma;

  const supabase = await createClient();
  const { data } = await supabase
    .from("ai_api_integrations")
    .select(`${COLUNAS_DA_INTEGRACAO}, endpoints:ai_api_endpoints!ai_api_endpoints_integration_id_fkey(id, modo, ativo)`)
    .eq("organization_id", activeOrg.orgId)
    .is("arquivada_em", null)
    .order("created_at", { ascending: true });

  const chave = chaveDeCifragemUtilizavel();

  return (
    <PaginaAjustes
      titulo={traduzir("Integrações via API", idioma)}
      descricao={traduzir(
        "Conecte os sistemas do seu negócio para o agente buscar dados de verdade ao responder — um pedido, uma conta, um status. Correções só rodam depois que o cliente confirma, e consultas a uma conta exigem que ele prove por e-mail que é o dono.",
        idioma,
      )}
    >
      {!chave.ok ? (
        <p className="rounded-md border border-warning-fg/30 bg-warning-bg p-3 text-sm text-warning-fg" data-testid="integracoes-sem-chave">
          {traduzir("A chave de criptografia da instalação não está utilizável, então não dá para guardar a chave de acesso de uma API.", idioma)}{" "}
          {chave.comoCorrigir}
        </p>
      ) : null}
      {!isEmailConfigured() ? (
        <p className="rounded-md border border-warning-fg/30 bg-warning-bg p-3 text-sm text-warning-fg" data-testid="integracoes-sem-email">
          {traduzir(
            "O envio de e-mail não está configurado nesta instalação. Consultas que não dependem da conta do cliente funcionam; as que exigem o código de verificação, não.",
            idioma,
          )}
        </p>
      ) : null}
      <ListaDeIntegracoes
        integracoes={(data ?? []) as unknown as IntegracaoDaLista[]}
        podeEscrever={ROLE_RANK[activeOrg.role] >= ROLE_RANK.admin}
      />
    </PaginaAjustes>
  );
}
