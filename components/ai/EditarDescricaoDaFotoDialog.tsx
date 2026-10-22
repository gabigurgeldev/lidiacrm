"use client";

import { useT } from "@/hooks/i18n/useT";
/**
 * EDITAR A DESCRIÇÃO DE UMA FOTO DO ACERVO.
 *
 * A descrição não é legenda: é por ELA que o agente acha a foto. O modelo não
 * vê a imagem ao procurar no acervo, só este texto — então "cor 1B" escrito
 * errado é uma foto que nunca é enviada. Por isso o diálogo abre já com o texto
 * atual (salvar um campo vazio apagaria a única coisa que torna a foto
 * alcançável) e recusa no navegador o que a rota recusaria.
 */
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useEditarDescricaoDaFoto } from "@/hooks/ai/useKnowledgeSources";
import { DESCRICAO_DA_FOTO_MAX, DESCRICAO_DA_FOTO_MIN } from "@/lib/ai/rag/imagem";

interface Props {
  sourceId: string;
  nome: string;
  descricaoAtual: string;
  aberto: boolean;
  onFechar: () => void;
  onSalvo: () => void;
}

export function EditarDescricaoDaFotoDialog({
  sourceId,
  nome,
  descricaoAtual,
  aberto,
  onFechar,
  onSalvo,
}: Props) {
  const t = useT();
  const [texto, setTexto] = useState(descricaoAtual);
  const editar = useEditarDescricaoDaFoto();

  function salvar(): void {
    const limpo = texto.trim();
    if (limpo.length < DESCRICAO_DA_FOTO_MIN) {
      toast.error(t("Descreva o que a foto mostra — é por esse texto que o agente a encontra."));
      return;
    }
    if (limpo.length > DESCRICAO_DA_FOTO_MAX) {
      toast.error(t("A descrição passou do limite de 2.000 caracteres."));
      return;
    }
    editar.mutate(
      { id: sourceId, descricao: limpo },
      {
        onSuccess: () => {
          onSalvo();
          onFechar();
        },
      },
    );
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t("Descrição de")} “{nome}”
          </DialogTitle>
          <DialogDescription>
            {t(
              "O agente não vê a foto ao procurar — ele lê esta descrição. Escreva o que um cliente perguntaria: produto, cor, tamanho, modelo.",
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor={`foto-descricao-${sourceId}`}>{t("Descrição da foto")}</Label>
          <Textarea
            id={`foto-descricao-${sourceId}`}
            data-testid="foto-descricao-editar"
            rows={5}
            maxLength={DESCRICAO_DA_FOTO_MAX}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            disabled={editar.isPending}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={editar.isPending}>
            {t("Cancelar")}
          </Button>
          <Button onClick={salvar} disabled={editar.isPending} data-testid="foto-descricao-salvar">
            {editar.isPending ? t("Salvando…") : t("Salvar descrição")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
