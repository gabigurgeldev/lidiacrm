"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { salvarAssinatura } from "@/app/actions/settings/salvarAssinatura";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/hooks/i18n/useT";
import {
  NOME_DA_ASSINATURA_MAX,
  nomeDaAssinaturaSchema,
  type AssinaturaDoAtendente,
} from "@/lib/assinatura-do-atendente";
import { Signature } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

interface Props {
  /** A preferência em vigor (`null` = nunca configurada). */
  valor: AssinaturaDoAtendente | null;
  /** Nome sugerido quando ainda não há assinatura — o nome do perfil. */
  nomePadrao: string | null;
  /** Chamado com o que foi salvo, para o composer refletir sem esperar o layout. */
  onSalvo: (assinatura: AssinaturaDoAtendente) => void;
  disabled?: boolean;
}

/**
 * O botão de assinatura do composer: liga/desliga e define o nome que vai em
 * cima de cada mensagem (`*Maria:*`). Mora ao lado do emoji porque é decisão
 * de quem está digitando, tomada no lugar onde se digita.
 */
export function AssinaturaDoAtendenteButton({ valor, nomePadrao, onSalvo, disabled }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [ativa, setAtiva] = useState(valor?.ativa ?? false);
  const [nome, setNome] = useState(valor?.nome ?? nomePadrao ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, startSalvar] = useTransition();

  // Reabrir o popover mostra o que está EM VIGOR, não o rascunho abandonado.
  function alternar(aberto: boolean) {
    if (aberto) {
      setAtiva(valor?.ativa ?? false);
      setNome(valor?.nome ?? nomePadrao ?? "");
      setErro(null);
    }
    setOpen(aberto);
  }

  const ligada = valor?.ativa === true;

  function salvar() {
    const parsed = nomeDaAssinaturaSchema.safeParse(nome);
    if (!parsed.success) {
      setErro(t("Use um nome de 1 a 40 caracteres, sem * nem quebra de linha."));
      return;
    }
    startSalvar(async () => {
      const r = await salvarAssinatura({ ativa, nome: parsed.data });
      if (!r.ok) {
        toast.error(t("Não foi possível salvar a assinatura."));
        return;
      }
      onSalvo(r.assinatura);
      setOpen(false);
      toast.success(r.assinatura.ativa ? t("Assinatura ligada.") : t("Assinatura desligada."));
      // Sem `router.refresh()`: o `revalidatePath` da action já devolve o layout
      // novo junto da resposta, e o AuthProvider recebe a preferência por ali.
    });
  }

  return (
    <Popover open={open} onOpenChange={alternar}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className={cn("h-9 w-9 shrink-0", ligada && "text-primary")}
          aria-label={t("Assinatura das mensagens")}
          aria-pressed={ligada}
          title={ligada ? t("Assinatura ligada") : t("Assinatura desligada")}
          disabled={disabled}
        >
          <Signature size={18} weight={ligada ? "bold" : "regular"} aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-72 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="assinatura-ativa" className="text-sm font-medium">
            {t("Assinar minhas mensagens")}
          </Label>
          <Switch id="assinatura-ativa" checked={ativa} onCheckedChange={setAtiva} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="assinatura-nome" className="text-xs text-muted-foreground">
            {t("Nome da assinatura")}
          </Label>
          <Input
            id="assinatura-nome"
            value={nome}
            maxLength={NOME_DA_ASSINATURA_MAX}
            onChange={(e) => {
              setNome(e.target.value);
              setErro(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                salvar();
              }
            }}
            placeholder={t("Ex.: Maria")}
          />
          {erro && <p className="text-xs text-destructive">{erro}</p>}
        </div>
        <div className="rounded-md bg-muted px-3 py-2 text-xs">
          <div className="mb-1 text-muted-foreground">{t("O cliente vê assim:")}</div>
          <div className="font-semibold">{(nome.trim() || t("Seu nome")) + ":"}</div>
          <div className="text-muted-foreground">{t("Olá! Como posso ajudar?")}</div>
        </div>
        <Button type="button" size="sm" className="w-full" onClick={salvar} disabled={salvando}>
          {salvando ? t("Salvando…") : t("Salvar")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
