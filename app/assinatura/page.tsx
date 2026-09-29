/**
 * /assinatura — a tela de pagamento da assinatura.
 *
 * FORA de `app/app/layout.tsx` de propósito: é para cá que o layout do app
 * manda quem está bloqueado, e dentro dele seria redirect em laço. Exige
 * login (não é rota pública) e usa a organização ativa da sessão.
 *
 * Serve três pessoas:
 *   - bloqueada (teste acabou / mensalidade atrasada): só tem esta tela;
 *   - em teste ou em dia: pode assinar antes ou trocar a forma de pagamento,
 *     e tem o botão de voltar ao CRM;
 *   - membro que não é admin: vê a situação e o recado "peça a um administrador".
 */
import { redirect } from "next/navigation";

import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { acessoDaOrganizacao } from "@/lib/billing/servico";
import { cobrancaLigada } from "@/lib/billing/asaas";
import { env } from "@/lib/env";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";

import { TelaDeAssinatura } from "./_client";

export const metadata = { title: "Assinatura" };
export const dynamic = "force-dynamic";

export default async function AssinaturaPage() {
  const user = await loadAuthUser();
  if (!user) redirect("/login?next=/assinatura");
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app");
  if (!cobrancaLigada()) redirect("/app");

  const { estado } = await acessoDaOrganizacao(org.orgId);
  const locale = user.locale ?? null;

  return (
    <IdiomaProvider locale={locale}>
      <TelaDeAssinatura
        estado={estado}
        organizacao={org.name}
        podePagar={org.role === "admin"}
        email={user.email}
        valorCentavos={env.COBRANCA_VALOR_CENTAVOS}
      />
    </IdiomaProvider>
  );
}
