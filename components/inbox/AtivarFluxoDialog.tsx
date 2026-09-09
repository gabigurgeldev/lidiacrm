"use client";
import { toast } from "sonner";

import { useT } from "@/hooks/i18n/useT";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAtivarFluxoManual, useFluxosManuais } from "@/hooks/flows/useFlows";
import { CircleNotch, FlowArrow } from "@/lib/ui/icons";

interface Props {
  conversationId: string;
  contactId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

/**
 * O seletor de "Ativar fluxo" — a mão do atendente disparando um fluxo de
 * gatilho `trigger.manual` para o contato desta conversa.
 *
 * A lista só carrega com o diálogo aberto (não paga a busca a cada render do
 * cabeçalho) e vem da rota agent+ `/flows/manuais`. Sem nenhum fluxo manual
 * ligado, diz COMO criar um em vez de mostrar um vazio mudo.
 */
export function AtivarFluxoDialog({ conversationId, contactId, open, onOpenChange }: Props) {
  const t = useT();
  const fluxos = useFluxosManuais(conversationId, open);
  const ativar = useAtivarFluxoManual();

  function disparar(flowId: string, nome: string) {
    if (!contactId) {
      toast.error(t("Esta conversa ainda não tem um contato para receber o fluxo."));
      return;
    }
    ativar.mutate(
      { conversationId, flow_id: flowId },
      {
        onSuccess: (d) => {
          toast.success(
            d.ja_estava_rodando
              ? t(`O fluxo “${nome}” já estava rodando para este contato.`)
              : t(`Fluxo “${nome}” ativado.`),
          );
          onOpenChange(false);
        },
        onError: () => toast.error(t("Não deu para ativar o fluxo. Tente de novo.")),
      },
    );
  }

  const lista = fluxos.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Ativar fluxo")}</DialogTitle>
          <DialogDescription>
            {t("Escolha um fluxo para disparar agora para este contato.")}
          </DialogDescription>
        </DialogHeader>

        {fluxos.isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <CircleNotch size={16} className="animate-spin" aria-hidden />
            {t("Carregando fluxos...")}
          </div>
        ) : lista.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            {t(
              "Nenhum fluxo de ativação manual ligado. Crie um fluxo com o bloco de início “Ativação manual pelo botão”, publique e ligue-o.",
            )}
          </p>
        ) : (
          <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto py-1">
            {lista.map((f) => (
              <Button
                key={f.id}
                type="button"
                variant="outline"
                className="justify-start gap-2"
                disabled={ativar.isPending}
                data-testid="opcao-de-fluxo-manual"
                onClick={() => disparar(f.id, f.name)}
              >
                <FlowArrow size={16} aria-hidden />
                <span className="truncate">{f.name}</span>
              </Button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
