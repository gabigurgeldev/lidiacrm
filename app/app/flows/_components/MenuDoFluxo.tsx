"use client";

import { useState } from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
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
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApagarFluxo, type FluxoDaLista } from "@/hooks/flows/useFlows";
import { useT } from "@/hooks/i18n/useT";
import { DotsThree, PencilSimple, Trash } from "@/lib/ui/icons";

import { RenomearFluxoDialog } from "./RenomearFluxoDialog";

/**
 * As ações de um fluxo na lista.
 *
 * A rota de excluir e a de renomear existiam desde o primeiro dia do motor —
 * `useApagarFluxo` estava no repo sem nenhum chamador. O que faltava era a
 * porta: quem queria trocar o nome recriava o fluxo, e quem queria apagar não
 * tinha caminho nenhum pela tela.
 */
export function MenuDoFluxo({ fluxo }: { fluxo: FluxoDaLista }) {
  const t = useT();
  const [renomeando, setRenomeando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const apagar = useApagarFluxo();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={t("Menu de ações")}
            data-testid={`menu-do-fluxo-${fluxo.id}`}
          >
            <DotsThree size={18} aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setRenomeando(true);
            }}
            data-testid={`renomear-fluxo-${fluxo.id}`}
          >
            <PencilSimple size={14} aria-hidden className="mr-2" />
            {t("Renomear")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={(e) => {
              e.preventDefault();
              setExcluindo(true);
            }}
            data-testid={`excluir-fluxo-${fluxo.id}`}
          >
            <Trash size={14} aria-hidden className="mr-2" />
            {t("Excluir")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {renomeando && (
        <RenomearFluxoDialog fluxo={fluxo} onFechar={() => setRenomeando(false)} />
      )}

      <AlertDialog open={excluindo} onOpenChange={setExcluindo}>
        <AlertDialogContent data-testid="confirmar-excluir-fluxo">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("Excluir")} &ldquo;{fluxo.name}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "As versões publicadas e o histórico de execuções deste fluxo somem junto. Não dá para desfazer. Fluxo com execução em andamento não é apagado — pause e espere terminar.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancelar")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={apagar.isPending}
              data-testid="confirmar-exclusao-do-fluxo"
              onClick={(e) => {
                e.preventDefault();
                apagar.mutate(fluxo.id, {
                  onSuccess: () => {
                    setExcluindo(false);
                    toast.success(t("Fluxo excluído."));
                  },
                  // O diálogo NÃO fecha no erro: o 409 de execução viva é uma
                  // recusa acionável ("pause e espere"), e fechar a janela
                  // junto com o toast tira a pessoa do contexto da decisão.
                  onError: (err) => showApiError(err),
                });
              }}
            >
              {apagar.isPending ? t("Excluindo…") : t("Excluir")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
