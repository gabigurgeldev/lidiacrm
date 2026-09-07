"use client";

import { useState } from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRenomearFluxo, type FluxoDaLista } from "@/hooks/flows/useFlows";
import { useT } from "@/hooks/i18n/useT";

interface Props {
  fluxo: FluxoDaLista;
  onFechar: () => void;
}

/**
 * Renomear um fluxo.
 *
 * Montado SÓ enquanto aberto (o pai o renderiza condicionalmente): assim o
 * campo nasce com o nome atual e não precisa de `useEffect` para
 * ressincronizar quando reabre. O molde irmão (`RenameAgentDialog`) usa efeito
 * e cai no `react-hooks/set-state-in-effect`; não há por que herdar isso.
 */
export function RenomearFluxoDialog({ fluxo, onFechar }: Props) {
  const t = useT();
  const [nome, setNome] = useState(fluxo.name);
  const renomear = useRenomearFluxo(fluxo.id);

  const limpo = nome.trim();

  async function aoEnviar(e: React.FormEvent) {
    e.preventDefault();
    if (limpo === "") return;
    try {
      await renomear.mutateAsync(limpo);
      toast.success(t("Fluxo renomeado."));
      onFechar();
    } catch (err) {
      // O diálogo NÃO fecha no erro. O 409 de nome repetido é uma recusa
      // acionável — a pessoa corrige o nome ali mesmo, com o que digitou ainda
      // na tela.
      showApiError(err);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(aberto) => {
        if (!aberto) onFechar();
      }}
    >
      <DialogContent data-testid="dialogo-renomear-fluxo">
        <DialogHeader>
          <DialogTitle>{t("Renomear fluxo")}</DialogTitle>
          <DialogDescription>
            {t(
              "Só o nome muda. As versões publicadas, o histórico e as ligações do quadro continuam como estão.",
            )}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={aoEnviar} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="novo-nome-do-fluxo">{t("Nome")}</Label>
            <Input
              id="novo-nome-do-fluxo"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              // 80 é o teto de `editarFluxoSchema`: cortar aqui evita um 400
              // que a pessoa só entenderia depois de enviar.
              maxLength={80}
              required
              autoFocus
              data-testid="campo-novo-nome-do-fluxo"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onFechar}>
              {t("Cancelar")}
            </Button>
            <Button
              type="submit"
              disabled={renomear.isPending || limpo === ""}
              data-testid="salvar-novo-nome"
            >
              {renomear.isPending ? t("Salvando…") : t("Salvar")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
