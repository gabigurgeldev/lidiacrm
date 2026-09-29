"use client";
import Link from "next/link";
import { useState } from "react";

import { Checkout, reaisDe } from "@/components/billing/Checkout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/hooks/i18n/useT";
import {
  STATUS_PAGOS_NA_TELA,
  useCancelarAssinatura,
  useStatusDaAssinatura,
} from "@/hooks/useAssinatura";

const data = (iso: string | null) =>
  iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString("pt-BR") : "—";

function SeloDoStatus({ status }: { status: string }) {
  const t = useT();
  if (STATUS_PAGOS_NA_TELA.has(status)) return <Badge variant="success">{t("Paga")}</Badge>;
  if (status === "OVERDUE") return <Badge variant="error">{t("Vencida")}</Badge>;
  if (status === "PENDING") return <Badge variant="warning">{t("Em aberto")}</Badge>;
  if (status === "REFUNDED" || status === "CHARGEBACK") return <Badge variant="neutral">{t("Estornada")}</Badge>;
  return <Badge variant="neutral">{status}</Badge>;
}

export function GerenciarAssinatura({ email }: { email: string }) {
  const t = useT();
  const { data: s, isLoading } = useStatusDaAssinatura();
  const cancelar = useCancelarAssinatura();
  const [trocando, setTrocando] = useState(false);
  const [confirmandoCancelamento, setConfirmandoCancelamento] = useState(false);

  if (isLoading || !s) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  const a = s.assinatura;
  const titulo = (
    <header>
      <h1 className="text-2xl font-semibold tracking-tight">{t("Assinatura")}</h1>
      <p className="text-sm text-muted-foreground">{t("Plano, forma de pagamento e faturas.")}</p>
    </header>
  );

  if (!s.cobranca_ligada || a?.isenta) {
    return (
      <div className="grid max-w-3xl gap-6">
        {titulo}
        <div className="rounded-xl border bg-card p-6 text-sm">
          <p className="font-semibold">{a?.isenta ? t("Organização isenta de cobrança") : t("Cobrança desligada")}</p>
          <p className="mt-1 text-muted-foreground">{t("Não há nada a pagar por esta organização.")}</p>
        </div>
      </div>
    );
  }

  const e = s.estado;
  const rotuloDoEstado =
    e.motivo === "trial"
      ? `${t("Teste grátis")} · ${e.diasRestantes} ${e.diasRestantes === 1 ? t("dia restante") : t("dias restantes")}`
      : e.motivo === "ativa"
        ? t("Ativa")
        : e.motivo === "tolerancia"
          ? t("Pagamento pendente")
          : e.motivo === "cancelada"
            ? t("Cancelada")
            : t("Bloqueada");

  const proxima = s.em_aberto ?? null;

  return (
    <div className="grid max-w-4xl gap-6">
      {titulo}

      <section className="grid gap-4 rounded-xl border bg-card p-5 sm:grid-cols-3 sm:p-6" data-testid="resumo-da-assinatura">
        <div>
          <p className="text-xs text-muted-foreground">{t("Situação")}</p>
          <p className="mt-1 font-semibold">{rotuloDoEstado}</p>
          {a?.pago_ate && e.motivo === "ativa" && (
            <p className="text-xs text-muted-foreground">
              {t("Pago até")} {data(a.pago_ate)}
            </p>
          )}
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t("Mensalidade")}</p>
          <p className="mt-1 font-semibold tabular-nums">{a ? reaisDe(a.valor_centavos) : "—"}</p>
          {proxima && (
            <p className="text-xs text-muted-foreground">
              {t("Próxima cobrança")} {data(proxima.vencimento)}
            </p>
          )}
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t("Forma de pagamento")}</p>
          <p className="mt-1 font-semibold">
            {a?.metodo === "CREDIT_CARD"
              ? `${(a.cartao_bandeira ?? t("Cartão")).toString()} •••• ${a.cartao_final ?? ""}`
              : a?.metodo === "PIX"
                ? "PIX"
                : t("Nenhuma ainda")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 sm:col-span-3">
          {!a?.tem_assinatura_no_asaas || e.motivo === "cancelada" || !e.liberado ? (
            <Button asChild>
              <Link href="/assinatura">{e.liberado ? t("Assinar agora") : t("Pagar agora")}</Link>
            </Button>
          ) : (
            <>
              {proxima && (
                <Button asChild>
                  <Link href="/assinatura">{t("Pagar agora")}</Link>
                </Button>
              )}
              <Button variant="outline" onClick={() => setTrocando(true)} data-testid="trocar-forma">
                {t("Trocar forma de pagamento")}
              </Button>
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirmandoCancelamento(true)}
              >
                {t("Cancelar assinatura")}
              </Button>
            </>
          )}
        </div>
      </section>

      <section className="rounded-xl border bg-card">
        <h2 className="border-b px-5 py-3 text-sm font-semibold">{t("Faturas")}</h2>
        {s.cobrancas.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">{t("Nenhuma fatura ainda.")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-5 py-2 font-medium">{t("Vencimento")}</th>
                  <th className="px-5 py-2 font-medium">{t("Valor")}</th>
                  <th className="px-5 py-2 font-medium">{t("Forma")}</th>
                  <th className="px-5 py-2 font-medium">{t("Situação")}</th>
                  <th className="px-5 py-2" />
                </tr>
              </thead>
              <tbody>
                {s.cobrancas.map((c) => (
                  <tr key={c.asaas_payment_id} className="border-t">
                    <td className="px-5 py-2.5">{data(c.vencimento)}</td>
                    <td className="px-5 py-2.5 tabular-nums">{reaisDe(c.valor_centavos)}</td>
                    <td className="px-5 py-2.5">{c.metodo === "CREDIT_CARD" ? t("Cartão") : c.metodo ?? "—"}</td>
                    <td className="px-5 py-2.5">
                      <SeloDoStatus status={c.status} />
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      {c.url_fatura && (
                        <a href={c.url_fatura} target="_blank" rel="noreferrer" className="text-xs font-medium text-accent hover:underline">
                          {t("Ver fatura")}
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Dialog open={trocando} onOpenChange={setTrocando}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("Trocar forma de pagamento")}</DialogTitle>
            <DialogDescription>{t("Vale para as próximas mensalidades.")}</DialogDescription>
          </DialogHeader>
          <Checkout emailInicial={email} modo="gerenciar" destinoDepois="/app/settings/billing" />
        </DialogContent>
      </Dialog>

      <Dialog open={confirmandoCancelamento} onOpenChange={setConfirmandoCancelamento}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Cancelar assinatura?")}</DialogTitle>
            <DialogDescription>
              {a?.pago_ate
                ? `${t("O acesso continua até")} ${data(a.pago_ate)}. ${t("Depois disso o CRM e as automações são pausados.")}`
                : t("O CRM e as automações são pausados quando o período atual terminar.")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmandoCancelamento(false)}>
              {t("Manter assinatura")}
            </Button>
            <Button
              variant="destructive"
              disabled={cancelar.isPending}
              onClick={() => cancelar.mutate(undefined, { onSuccess: () => setConfirmandoCancelamento(false) })}
            >
              {cancelar.isPending ? t("Cancelando...") : t("Cancelar assinatura")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
