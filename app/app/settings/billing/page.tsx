import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";

import { GerenciarAssinatura } from "./_client";

export const dynamic = "force-dynamic";

/**
 * Configurações › Assinatura — situação, próxima cobrança, forma de pagamento,
 * histórico de faturas, trocar cartão / mudar para PIX, cancelar.
 *
 * Admin-only (spec 13 §4). O pagamento em si é o mesmo componente da tela
 * `/assinatura` (`components/billing/Checkout.tsx`) — uma implementação só.
 */
export default async function BillingPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg || ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    redirect("/403");
  }
  return <GerenciarAssinatura email={user.email} />;
}
