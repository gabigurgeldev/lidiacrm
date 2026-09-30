"use client";
import { useEffect, useId, useRef, useState, type ComponentType } from "react";

import { useT } from "@/hooks/i18n/useT";
import { useDraftReply } from "@/hooks/inbox/useDraftReply";
import {
  CircleNotch,
  FileText,
  ImageSquare,
  Lightning,
  Note,
  Plus,
  Sparkle,
  UserCircle,
} from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

interface Props {
  conversationId: string;
  modo: "reply" | "note";
  /** Resposta barrada (janela fechada, envio travado): anexos e IA somem. */
  respostaBarrada: boolean;
  /** Tudo travado (contato bloqueado, upload em curso). */
  desabilitado: boolean;
  onArquivo: (file: File) => void;
  onContato: () => void;
  onMensagensProntas: () => void;
  onRascunho: (texto: string) => void;
  onAlternarNota: () => void;
}

interface Opcao {
  id: string;
  rotulo: string;
  Icone: ComponentType<{
    size?: number;
    weight?: "regular" | "fill" | "duotone";
    className?: string;
  }>;
  /** Tom do círculo — tons da paleta, para o olho achar pela cor depois da 1ª vez. */
  tom: string;
  acao: () => void;
  ocupado?: boolean;
  /** Item que abre o seletor de arquivos: vira `<label for>` do input. */
  inputId?: string;
}

/**
 * O "+" do campo de escrever: UM botão, e as opções num painel que sobe de cima
 * dele, como no WhatsApp. Antes eram quatro ícones soltos disputando a linha com
 * o texto — e o campo encolhia justamente em tela estreita.
 *
 * Os `<input type="file">` vivem FORA do painel: ele desmonta ao fechar, e um
 * input desmontado no meio do clique perde o seletor de arquivos ("nada
 * acontece"). O `.click()` síncrono no clique do item preserva o gesto do
 * usuário, que o navegador exige para abrir o seletor.
 */
export function MenuDeOpcoes({
  conversationId,
  modo,
  respostaBarrada,
  desabilitado,
  onArquivo,
  onContato,
  onMensagensProntas,
  onRascunho,
  onAlternarNota,
}: Props) {
  const t = useT();
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement | null>(null);
  const idMidia = useId();
  const idDoc = useId();
  const rascunho = useDraftReply();

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAberto(false);
    };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  const fecharDepois = () => setTimeout(() => setAberto(false), 0);

  const escolher = (fn: () => void) => () => {
    fn();
    setAberto(false);
  };

  const opcoes: Opcao[] = [];
  if (modo === "reply" && !respostaBarrada) {
    opcoes.push(
      {
        id: "midia",
        rotulo: t("Fotos e vídeos"),
        Icone: ImageSquare,
        tom: "bg-accent-soft text-accent",
        inputId: idMidia,
        // Fecha DEPOIS do clique: o rótulo precisa estar no documento quando o
        // navegador encaminha o clique ao input.
        acao: fecharDepois,
      },
      {
        id: "documento",
        rotulo: t("Documento"),
        Icone: FileText,
        tom: "bg-info-bg text-info",
        inputId: idDoc,
        acao: fecharDepois,
      },
      {
        id: "contato",
        rotulo: t("Contato"),
        Icone: UserCircle,
        tom: "bg-surface-elevated text-foreground",
        acao: escolher(onContato),
      },
      {
        id: "prontas",
        rotulo: t("Mensagens prontas"),
        Icone: Lightning,
        tom: "bg-warning-bg text-warning-fg",
        acao: escolher(onMensagensProntas),
      },
      {
        id: "ia",
        rotulo: t("Sugerir resposta"),
        Icone: rascunho.isPending ? CircleNotch : Sparkle,
        tom: "bg-accent-soft text-accent",
        ocupado: rascunho.isPending,
        acao: () => {
          if (rascunho.isPending) return;
          rascunho.mutate(conversationId, {
            onSuccess: (res) => {
              onRascunho(res.data.draft);
              setAberto(false);
            },
          });
        },
      },
    );
  }
  opcoes.push({
    id: "nota",
    rotulo: modo === "note" ? t("Voltar a responder") : t("Nota interna"),
    Icone: Note,
    tom: "bg-warning-bg text-warning-fg",
    acao: escolher(onAlternarNota),
  });

  const aoEscolherArquivo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onArquivo(file);
    e.target.value = ""; // permite escolher o mesmo arquivo de novo
  };

  return (
    <div ref={raiz} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        disabled={desabilitado}
        aria-label={t("Anexar")}
        title={t("Opções")}
        aria-haspopup="menu"
        aria-expanded={aberto}
        className={cn(
          "opcoes-gatilho flex size-10 items-center justify-center rounded-full text-muted-foreground",
          "transition-colors hover:bg-black/5 hover:text-foreground disabled:opacity-40",
          aberto && "bg-black/5 text-foreground",
        )}
      >
        <Plus size={24} weight="regular" aria-hidden />
      </button>

      {aberto && (
        <div
          role="menu"
          aria-label={t("Opções")}
          className="opcoes-painel absolute bottom-full left-0 z-30 mb-3 w-64 rounded-2xl border border-border bg-background p-2 shadow-lg"
        >
          {opcoes.map(({ id, rotulo, Icone, tom, acao, ocupado, inputId }, i) => {
            const conteudo = (
              <>
                <span
                  className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", tom)}
                >
                  <Icone size={19} weight="fill" className={ocupado ? "animate-spin" : undefined} />
                </span>
                <span className="truncate">{rotulo}</span>
              </>
            );
            const classe =
              "opcoes-item flex w-full cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-left text-[15px] transition-colors hover:bg-surface-elevated focus-visible:bg-surface-elevated focus-visible:outline-none";
            const estilo = { "--i": i } as React.CSSProperties;
            // Anexo = `<label for>` do input escondido: o clique no rótulo abre
            // o seletor de arquivos pelo próprio navegador, com o gesto do usuário
            // intacto — sem ref, sem `.click()` programático.
            return inputId ? (
              <label
                key={id}
                htmlFor={inputId}
                role="menuitem"
                tabIndex={0}
                aria-label={rotulo}
                onClick={acao}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    (document.getElementById(inputId) as HTMLInputElement | null)?.click();
                    acao();
                  }
                }}
                style={estilo}
                className={classe}
              >
                {conteudo}
              </label>
            ) : (
              <button
                key={id}
                type="button"
                role="menuitem"
                onClick={acao}
                aria-label={rotulo}
                aria-busy={ocupado || undefined}
                style={estilo}
                className={classe}
              >
                {conteudo}
              </button>
            );
          })}
        </div>
      )}

      <input
        id={idMidia}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={aoEscolherArquivo}
      />
      <input
        id={idDoc}
        type="file"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
        className="hidden"
        onChange={aoEscolherArquivo}
      />
    </div>
  );
}
