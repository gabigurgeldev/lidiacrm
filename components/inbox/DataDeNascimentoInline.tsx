"use client";
import { useState } from "react";

import { useT } from "@/hooks/i18n/useT";
import { useUpdateContact } from "@/hooks/contacts/useUpdateContact";
import { Cake, Check, CircleNotch } from "@/lib/ui/icons";
import { dataDeNascimentoValida } from "@/lib/schemas/contacts";

interface Props {
  contactId: string;
  /** `YYYY-MM-DD` ou `null`. */
  valor: string | null;
}

/**
 * Data de nascimento no painel do contato, que SALVA SOZINHA — ao sair do campo
 * ou apertar Enter, sem botão "Salvar".
 *
 * É a data que alimenta a mensagem de parabéns automática (Configurações ›
 * Aniversários). Pedido do dono: preencher no meio do atendimento, quando o
 * cliente conta, sem abrir outra tela.
 *
 * Regras (as mesmas do diálogo de edição, `EditContactDialog`):
 *  - só envia quando MUDOU — sair do campo sem mexer não gera escrita;
 *  - vazio envia `null`, que apaga a data;
 *  - data impossível ou no futuro não sai: a validação é a do schema da API
 *    (`dataDeNascimentoValida`), então a tela e o servidor recusam o mesmo.
 */
export function DataDeNascimentoInline({ contactId, valor }: Props) {
  const t = useT();
  const atualizar = useUpdateContact(contactId);
  const [texto, setTexto] = useState(valor ?? "");
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const hoje = new Date().toISOString().slice(0, 10);

  function salvar() {
    const novo = texto.trim();
    if (novo === (valor ?? "")) return;
    if (novo !== "" && !dataDeNascimentoValida(novo)) {
      setErro(t("Data inválida."));
      return;
    }
    setErro(null);
    atualizar.mutate(
      { birthdate: novo === "" ? null : novo },
      {
        onSuccess: () => {
          setSalvo(true);
          setTimeout(() => setSalvo(false), 2000);
        },
        onError: () => setTexto(valor ?? ""),
      },
    );
  }

  return (
    <div className="space-y-1">
      <label
        htmlFor={`nascimento-${contactId}`}
        className="flex items-center gap-1.5 text-xs text-muted-foreground"
      >
        <Cake size={14} aria-hidden />
        {t("Data de nascimento")}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={`nascimento-${contactId}`}
          type="date"
          max={hoje}
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            setSalvo(false);
          }}
          onBlur={salvar}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              salvar();
            }
          }}
          disabled={atualizar.isPending}
          data-testid="nascimento-inline"
          className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 text-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <span className="flex w-16 shrink-0 items-center gap-1 text-xs" aria-live="polite">
          {atualizar.isPending ? (
            <>
              <CircleNotch size={13} className="animate-spin text-muted-foreground" aria-hidden />
              <span className="text-muted-foreground">{t("Salvando…")}</span>
            </>
          ) : salvo ? (
            <>
              <Check size={13} weight="bold" className="text-accent" aria-hidden />
              <span className="text-accent">{t("Salvo")}</span>
            </>
          ) : null}
        </span>
      </div>
      {erro && <p className="text-xs text-destructive">{erro}</p>}
    </div>
  );
}
