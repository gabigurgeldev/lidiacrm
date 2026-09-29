"use client";
/**
 * Faixa no topo do app para o ADMIN da organização quando a assinatura pede
 * atenção: últimos dias do teste grátis, ou mensalidade vencida dentro da
 * tolerância. Some sozinha quando paga — o estado vem do servidor a cada
 * navegação (`app/app/layout.tsx`).
 *
 * Não aparece para quem não é admin: quem não pode pagar não tem o que fazer
 * com o aviso, e ele competiria com o trabalho do dia.
 */
import Link from "next/link";

import { useT } from "@/hooks/i18n/useT";
import type { EstadoDeAcesso } from "@/lib/billing/acesso";

export function AvisoDeAssinatura({ estado }: { estado: EstadoDeAcesso }) {
  const t = useT();
  const dias = estado.diasRestantes ?? 0;
  const texto =
    estado.motivo === "trial"
      ? dias <= 1
        ? t("Seu teste grátis termina hoje.")
        : `${t("Seu teste grátis termina em")} ${dias} ${t("dias")}.`
      : estado.motivo === "cancelada"
        ? `${t("Sua assinatura foi cancelada e o acesso termina em")} ${dias} ${dias === 1 ? t("dia") : t("dias")}.`
        : `${t("Pagamento pendente — o acesso será bloqueado em")} ${dias} ${dias === 1 ? t("dia") : t("dias")}.`;

  return (
    <div
      role="status"
      data-testid="aviso-de-assinatura"
      className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2 text-sm"
      style={{
        background: "var(--color-warning-bg)",
        color: "var(--color-warning-fg)",
        borderColor: "color-mix(in srgb, var(--color-warning) 35%, transparent)",
      }}
    >
      <span className="font-medium">{texto}</span>
      <Link
        href="/assinatura"
        className="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:opacity-90"
      >
        {estado.motivo === "trial" ? t("Assinar agora") : t("Pagar agora")}
      </Link>
    </div>
  );
}
