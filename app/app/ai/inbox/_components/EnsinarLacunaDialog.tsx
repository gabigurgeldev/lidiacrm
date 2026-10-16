"use client";

/**
 * "Responder e ensinar o agente" — o dono escreve a resposta de uma pergunta
 * que o material não cobria (Central de lacunas, migration 0245).
 *
 * A pergunta chega preenchida com o que o cliente perguntou (já sem dados
 * pessoais) e PODE ser reescrita: é ela que o agente vai reconhecer depois, e
 * quem conhece o negócio sabe a forma mais clara de perguntá-la. A resposta é
 * escrita por quem ensina — nada aqui é gerado por modelo.
 */
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useResolverLacuna, type AgentInboxLacuna } from "@/hooks/ai/useAgentInbox";
import { useT } from "@/hooks/i18n/useT";

export function EnsinarLacunaDialog({
  lacuna,
  aberto,
  onFechar,
}: {
  lacuna: AgentInboxLacuna;
  aberto: boolean;
  onFechar: () => void;
}) {
  const t = useT();
  const [pergunta, setPergunta] = useState(lacuna.pergunta);
  const [resposta, setResposta] = useState("");
  const resolver = useResolverLacuna();

  const salvar = () => {
    if (pergunta.trim().length < 3) {
      toast.error(t("Escreva a pergunta."));
      return;
    }
    if (resposta.trim().length < 2) {
      toast.error(t("Escreva a resposta."));
      return;
    }
    resolver.mutate(
      { id: lacuna.id, acao: "ensinar", pergunta: pergunta.trim(), resposta: resposta.trim() },
      {
        onSuccess: () => {
          toast.success(t("Pronto: o agente passa a usar esta resposta em alguns instantes."));
          onFechar();
        },
        onError: showApiError,
      },
    );
  };

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("Responder e ensinar o agente")}</DialogTitle>
          <DialogDescription>
            {t("A resposta entra no material “Respostas ensinadas pela equipe”, que todos os agentes consultam.")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto pr-1">
          <div className="space-y-2">
            <Label htmlFor="lacuna-pergunta">{t("Pergunta do cliente")}</Label>
            <Textarea
              id="lacuna-pergunta"
              value={pergunta}
              onChange={(e) => setPergunta(e.target.value)}
              maxLength={500}
              rows={2}
              data-testid="lacuna-pergunta"
            />
            <p className="text-xs text-muted-foreground">
              {t("Pode reescrever: deixe a pergunta do jeito mais claro para o seu negócio.")}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="lacuna-resposta">{t("Resposta")}</Label>
            <Textarea
              id="lacuna-resposta"
              value={resposta}
              onChange={(e) => setResposta(e.target.value)}
              maxLength={4000}
              rows={5}
              placeholder={t("Escreva a resposta como gostaria que o agente respondesse.")}
              data-testid="lacuna-resposta"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={resolver.isPending}>
            {t("Cancelar")}
          </Button>
          <Button onClick={salvar} disabled={resolver.isPending} data-testid="lacuna-ensinar">
            {resolver.isPending ? t("Guardando…") : t("Ensinar o agente")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
