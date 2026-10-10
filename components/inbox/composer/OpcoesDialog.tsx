"use client";

import { useEffect, useState } from "react";

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
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import { MAXIMO_DE_OPCOES, MINIMO_DE_OPCOES } from "@/lib/channels/opcoes-interativas";
import { opcoesInterativasSchema, type OpcoesInterativas } from "@/lib/schemas";
import { ChartBar, ListChecks, Trash } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sending: boolean;
  onEnviar: (tipo: "poll" | "list", opcoes: OpcoesInterativas) => void;
}

const VAZIO = ["", ""];

/**
 * Montar uma enquete ou lista à mão, pelo "+" do campo de escrever.
 *
 * Não pergunta QUAL canal é: o envio decide pela conexão da conversa. Por isso
 * a frase de baixo existe — quem escolhe "Lista" num número que não desenha
 * lista precisa saber, antes de mandar, que o cliente vai ver a pergunta
 * numerada, e não achar depois que a lista "não funcionou".
 */
export function OpcoesDialog({ open, onOpenChange, sending, onEnviar }: Props) {
  const t = useT();
  const [formato, setFormato] = useState<"enquete" | "lista">("enquete");
  const [pergunta, setPergunta] = useState("");
  const [opcoes, setOpcoes] = useState<string[]>(VAZIO);

  useEffect(() => {
    if (!open) {
      setFormato("enquete");
      setPergunta("");
      setOpcoes(VAZIO);
    }
  }, [open]);

  const preenchidas = opcoes.map((o) => o.trim()).filter((o) => o !== "");
  const pedido = {
    pergunta: pergunta.trim(),
    opcoes: preenchidas.map((label, i) => ({ id: `o${i + 1}`, label })),
  };
  const valido = opcoesInterativasSchema.safeParse(pedido);
  const repetidas =
    preenchidas.length >= MINIMO_DE_OPCOES && !valido.success && pedido.pergunta !== "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Enquete ou lista")}</DialogTitle>
          <DialogDescription>
            {t("O cliente toca na opção em vez de digitar, e a escolha volta como resposta na conversa.")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("Formato")}>
          {(
            [
              { id: "enquete", rotulo: t("Enquete"), Icone: ChartBar },
              { id: "lista", rotulo: t("Lista de opções"), Icone: ListChecks },
            ] as const
          ).map(({ id, rotulo, Icone }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={formato === id}
              onClick={() => setFormato(id)}
              data-testid={`formato-${id}`}
              className={cn(
                "flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
                formato === id ? "border-accent bg-accent-soft text-accent" : "hover:bg-muted",
              )}
            >
              <Icone size={16} weight="duotone" aria-hidden />
              {rotulo}
            </button>
          ))}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="opcoes-pergunta">{t("Pergunta")}</Label>
          <Textarea
            id="opcoes-pergunta"
            rows={2}
            maxLength={1000}
            value={pergunta}
            onChange={(e) => setPergunta(e.target.value)}
            placeholder={t("Qual horário fica melhor para você?")}
            data-testid="campo-pergunta-das-opcoes"
          />
        </div>

        <div className="space-y-1.5">
          <Label>{t("Opções")}</Label>
          {opcoes.map((valor, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Input
                value={valor}
                maxLength={60}
                placeholder={`${t("Opção")} ${i + 1}`}
                onChange={(e) => setOpcoes(opcoes.map((o, j) => (j === i ? e.target.value : o)))}
                data-testid={`campo-opcao-${i + 1}`}
              />
              {opcoes.length > MINIMO_DE_OPCOES ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("Remover esta opção")}
                  onClick={() => setOpcoes(opcoes.filter((_, j) => j !== i))}
                >
                  <Trash size={16} aria-hidden />
                </Button>
              ) : null}
            </div>
          ))}
          {opcoes.length < MAXIMO_DE_OPCOES ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpcoes([...opcoes, ""])}
              data-testid="acrescentar-opcao-do-composer"
            >
              {t("Acrescentar opção")}
            </Button>
          ) : null}
          {repetidas ? (
            <p className="text-xs text-destructive">
              {t("Duas opções com o mesmo texto: o cliente não teria como escolher entre elas.")}
            </p>
          ) : null}
        </div>

        <p className="text-xs text-muted-foreground">
          {t(
            "Enquete aparece no número conectado por QR; lista, no QR (em conversa individual) e no número oficial. Onde o formato não existir, o cliente recebe a mesma pergunta numerada e responde o número.",
          )}
        </p>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t("Cancelar")}
          </Button>
          <Button
            type="button"
            disabled={!valido.success || sending}
            onClick={() => {
              if (valido.success) onEnviar(formato === "lista" ? "list" : "poll", valido.data);
            }}
            data-testid="enviar-opcoes"
          >
            {sending ? t("Enviando…") : t("Enviar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
