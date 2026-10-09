"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { refreshCredentialsView } from "../_actions";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ArrowsClockwise, Trash } from "@/lib/ui/icons";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import {
  credentialStatus,
  credentialsListQueryKey,
  type CredentialRow,
} from "@/hooks/ai/useCredentials";
import { useT } from "@/hooks/i18n/useT";

interface Props {
  credential: CredentialRow;
  canWrite: boolean;
  usageCount: number;
}

const STATUS_LABEL: Record<ReturnType<typeof credentialStatus>, string> = {
  validated: "Validada",
  validating: "Validando…",
  invalid: "Inválida",
  inactive: "Inativa",
};

const STATUS_VARIANT: Record<ReturnType<typeof credentialStatus>, "default" | "secondary" | "destructive" | "outline"> = {
  validated: "default",
  validating: "secondary",
  invalid: "destructive",
  inactive: "outline",
};

export function CredentialCard({ credential, canWrite, usageCount }: Props) {
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const status = credentialStatus(credential);
  const last4 = credential.api_key_last4 ?? "????";
  const inUse = usageCount > 0;

  const onRevalidate = () => {
    startTransition(async () => {
      try {
        await apiClient.post(`/api/v1/ai/credentials/${credential.id}/revalidate`, {});
        toast.success(t("Revalidando…"));
        await qc.invalidateQueries({ queryKey: credentialsListQueryKey });
      } catch (err) {
        showApiError(err);
      }
    });
  };

  const onDelete = () => {
    startTransition(async () => {
      try {
        await apiClient.delete(`/api/v1/ai/credentials/${credential.id}`);
        toast.success(t("Credencial removida."));
        setDeleteOpen(false);
        await qc.invalidateQueries({ queryKey: credentialsListQueryKey });
        await refreshCredentialsView();
        router.refresh();
      } catch (err) {
        showApiError(err);
      }
    });
  };

  const deleteButton = (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t("Excluir credencial")}
      disabled={!canWrite || inUse || isPending}
      onClick={() => setDeleteOpen(true)}
    >
      <Trash size={14} aria-hidden />
    </Button>
  );

  // Uma LINHA do grupo do provedor (kit de Ajustes), não um cartão solto: as
  // chaves de um provedor ficam juntas, e o que importa de cada uma — estado,
  // final da chave, quantos agentes dependem dela — cabe numa leitura.
  return (
    <div className="ios-linha" data-testid="credencial-linha">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-text" title={credential.label}>
          {credential.label}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          <span className="font-mono">…{last4}</span>
          {" · "}
          {credential.models_available ?? "—"} {t("modelos")}
          {" · "}
          {usageCount === 1
            ? t("em uso por 1 agente publicado")
            : `${t("em uso por")} ${usageCount} ${t("agentes publicados")}`}
        </p>
        {credential.validation_error && (
          <p className="mt-0.5 line-clamp-2 text-xs text-destructive" title={credential.validation_error}>
            {credential.validation_error}
          </p>
        )}
      </div>
      <Badge variant={STATUS_VARIANT[status]} className="flex-none text-xs">
        {t(STATUS_LABEL[status])}
      </Badge>
      {canWrite && (
        <div className="flex flex-none items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("Revalidar credencial")}
            disabled={isPending}
            onClick={onRevalidate}
          >
            <ArrowsClockwise size={14} aria-hidden />
          </Button>
          {inUse ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>{deleteButton}</span>
                </TooltipTrigger>
                <TooltipContent>
                  {t("Não dá para remover: há agentes publicados usando esta chave.")}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            deleteButton
          )}
        </div>
      )}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("Remover credencial")} &ldquo;{credential.label}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("Agentes que usam esta chave vão falhar ao responder. Esta ação não pode ser desfeita.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>{t("Cancelar")}</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete} disabled={isPending}>
              {t("Remover")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
