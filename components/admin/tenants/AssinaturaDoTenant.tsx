"use client";
/**
 * Bloco "Assinatura" na tela da organização do painel da plataforma: situação,
 * datas, vínculo no Asaas, a chave "Isenta de cobrança" e "Estender teste".
 *
 * Isentar libera na hora (o cache de acesso é invalidado pela rota) e fica no
 * audit como `billing.isencao_alterada`, com quem e de/para.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/hooks/i18n/useT";
import { tagDeIdioma } from "@/lib/i18n/datas";
import { useIdioma } from "@/lib/i18n/IdiomaProvider";
import { apiClient } from "@/lib/api/client";
import type { EstadoDeAcesso } from "@/lib/billing/acesso";

import { EstenderTeste } from "./EstenderTeste";

interface Resposta {
  data: {
    cobranca_ligada: boolean;
    estado: EstadoDeAcesso;
    assinatura: {
      status: string;
      isenta: boolean;
      trial_termina_em: string | null;
      pago_ate: string | null;
      metodo: string | null;
      asaas_customer_id: string | null;
      asaas_subscription_id: string | null;
    };
  };
}

export function AssinaturaDoTenant({ organizationId }: { organizationId: string }) {
  const t = useT();
  const tag = tagDeIdioma(useIdioma());
  const data = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(tag) : "—");
  const qc = useQueryClient();
  const chave = ["admin", "tenant-assinatura", organizationId] as const;
  const { data: r, isLoading } = useQuery({
    queryKey: chave,
    queryFn: () => apiClient.get<Resposta>(`/api/v1/admin/tenants/${organizationId}/assinatura`),
  });
  const isentar = useMutation({
    mutationFn: (isenta: boolean) =>
      apiClient.patch(`/api/v1/admin/tenants/${organizationId}/assinatura`, { isenta }),
    onError: showApiError,
    onSuccess: (_d, isenta) => {
      toast.success(isenta ? t("Organização isenta de cobrança.") : t("Isenção removida."));
      void qc.invalidateQueries({ queryKey: chave });
    },
  });

  if (isLoading || !r) return <Skeleton className="h-40 w-full rounded-lg" />;
  const { estado, assinatura: a, cobranca_ligada } = r.data;

  const selo = a.isenta ? (
    <Badge variant="info">{t("Isenta")}</Badge>
  ) : estado.liberado ? (
    <Badge variant={estado.motivo === "trial" ? "warning" : "success"}>
      {estado.motivo === "trial" ? t("Teste grátis") : estado.motivo === "tolerancia" ? t("Em tolerância") : t("Ativa")}
    </Badge>
  ) : (
    <Badge variant="error">{t("Bloqueada")}</Badge>
  );

  return (
    <Card data-testid="assinatura-do-tenant">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-sm font-medium">{t("Assinatura")}</CardTitle>
        {selo}
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        {!cobranca_ligada && (
          <p className="text-xs text-muted-foreground">
            {t("Cobrança desligada nesta instalação (sem ASAAS_API_KEY) — ninguém é bloqueado.")}
          </p>
        )}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
          <dt className="text-xs text-muted-foreground">{t("Teste até")}</dt>
          <dd>{data(a.trial_termina_em)}</dd>
          <dt className="text-xs text-muted-foreground">{t("Pago até")}</dt>
          <dd>{data(a.pago_ate)}</dd>
          <dt className="text-xs text-muted-foreground">{t("Forma")}</dt>
          <dd>{a.metodo === "CREDIT_CARD" ? t("Cartão") : a.metodo ?? "—"}</dd>
          <dt className="text-xs text-muted-foreground">Asaas</dt>
          <dd className="truncate font-mono text-[11px]" title={a.asaas_subscription_id ?? ""}>
            {a.asaas_subscription_id ?? "—"}
          </dd>
        </dl>
        <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
          <span>
            <span className="block font-medium">{t("Isenta de cobrança")}</span>
            <span className="block text-xs text-muted-foreground">
              {t("Nunca paga e nunca é bloqueada (sua empresa, parceiros).")}
            </span>
          </span>
          <Switch
            checked={a.isenta}
            disabled={isentar.isPending}
            onCheckedChange={(v) => isentar.mutate(v)}
            aria-label={t("Isenta de cobrança")}
            data-testid="switch-isenta"
          />
        </label>
        <EstenderTeste
          organizationId={organizationId}
          assinatura={a}
          temAssinaturaNoAsaas={a.asaas_subscription_id !== null}
          chaveDaConsulta={chave}
        />
      </CardContent>
    </Card>
  );
}
