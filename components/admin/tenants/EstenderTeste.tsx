"use client";
/**
 * "Estender teste" no bloco de Assinatura da organização (painel da plataforma).
 *
 * A prévia do novo fim usa `novaDataDoTeste`, a MESMA função que a rota usa
 * para gravar — o que o admin confirma é o que fica no banco.
 *
 * Quando estender não faz sentido (cancelada, paga, isenta) o bloco não
 * esconde: ele diz por quê. Um botão que some sem explicação faz o admin
 * procurar a opção em outro lugar.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import { tagDeIdioma } from "@/lib/i18n/datas";
import { useIdioma } from "@/lib/i18n/IdiomaProvider";
import { apiClient } from "@/lib/api/client";
import type { LinhaDeAssinatura } from "@/lib/billing/acesso";
import {
  MAX_DIAS_DE_EXTENSAO,
  novaDataDoTeste,
  podeEstender,
  type MotivoDeRecusa,
} from "@/lib/billing/estender-teste";

const ATALHOS = [7, 15, 30] as const;

const MOTIVO: Record<MotivoDeRecusa, string> = {
  cancelada: "Assinatura cancelada: estender o teste não libera o acesso.",
  paga: "Organização paga: o teste não está em uso.",
  isenta: "Organização isenta: nunca é bloqueada.",
};

interface Resposta {
  data: { trial_termina_em: string; status: string; aviso_asaas: boolean };
}


export function EstenderTeste({
  organizationId,
  assinatura,
  temAssinaturaNoAsaas,
  chaveDaConsulta,
}: {
  organizationId: string;
  assinatura: LinhaDeAssinatura;
  temAssinaturaNoAsaas: boolean;
  chaveDaConsulta: readonly unknown[];
}) {
  const t = useT();
  const tag = tagDeIdioma(useIdioma());
  const formatar = (d: Date | string | null) => (d ? new Date(d).toLocaleDateString(tag) : "—");
  const qc = useQueryClient();
  const [dias, setDias] = useState("7");
  const [confirmando, setConfirmando] = useState(false);

  const n = Number(dias);
  const valido = Number.isInteger(n) && n >= 1 && n <= MAX_DIAS_DE_EXTENSAO;
  const decisao = podeEstender(assinatura);
  const novoFim = valido ? novaDataDoTeste(assinatura.trial_termina_em, new Date(), n) : null;

  const estender = useMutation({
    mutationFn: (d: number) =>
      apiClient.post<Resposta>(`/api/v1/admin/tenants/${organizationId}/assinatura/estender-teste`, {
        dias: d,
      }),
    onError: showApiError,
    onSuccess: (r) => {
      setConfirmando(false);
      toast.success(`${t("Teste estendido até")} ${formatar(r.data.trial_termina_em)}.`);
      if (r.data.aviso_asaas) {
        toast.warning(
          t("A primeira cobrança já agendada no Asaas continua na data antiga. Ajuste-a no Asaas se precisar."),
        );
      }
      void qc.invalidateQueries({ queryKey: chaveDaConsulta });
    },
  });

  return (
    <div className="grid gap-3 rounded-lg border px-3 py-2.5" data-testid="estender-teste">
      <span>
        <span className="block font-medium">{t("Estender teste grátis")}</span>
        <span className="block text-xs text-muted-foreground">
          {t("Soma dias ao fim atual do teste (ou a hoje, se ele já venceu).")}
        </span>
      </span>

      {!decisao.pode ? (
        <p className="text-xs text-muted-foreground" data-testid="estender-teste-recusa">
          {t(MOTIVO[decisao.motivo])}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {ATALHOS.map((a) => (
              <Button
                key={a}
                type="button"
                size="sm"
                variant={dias === String(a) ? "default" : "outline"}
                onClick={() => setDias(String(a))}
              >
                +{a}
              </Button>
            ))}
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_DIAS_DE_EXTENSAO}
              value={dias}
              onChange={(e) => setDias(e.target.value)}
              className="h-8 w-20"
              aria-label={t("Dias a mais")}
              data-testid="estender-teste-dias"
            />
            <span className="text-xs text-muted-foreground">{t("dias")}</span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs" data-testid="estender-teste-previa">
              {novoFim
                ? `${t("Novo fim do teste:")} ${formatar(novoFim)}`
                : `${t("Informe de 1 a 365 dias.")}`}
            </span>
            <Button
              type="button"
              size="sm"
              disabled={!valido || estender.isPending}
              onClick={() => setConfirmando(true)}
              data-testid="estender-teste-botao"
            >
              {t("Estender")}
            </Button>
          </div>
        </>
      )}

      <AlertDialog open={confirmando} onOpenChange={(aberto) => !aberto && setConfirmando(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Estender teste grátis")}</AlertDialogTitle>
            <AlertDialogDescription>
              {`${t("Fim atual:")} ${formatar(assinatura.trial_termina_em)} · ${t("Novo fim:")} ${formatar(novoFim)}`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {temAssinaturaNoAsaas && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {t("Esta organização já tem assinatura no Asaas. A primeira cobrança agendada não muda com isto.")}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancelar")}</AlertDialogCancel>
            <Button
              onClick={() => valido && estender.mutate(n)}
              disabled={!valido || estender.isPending}
              data-testid="estender-teste-confirmar"
            >
              {estender.isPending ? t("Estendendo...") : t("Confirmar")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
