import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Uma tag do catálogo como se vê em toda tela: pílula tingida pela cor da tag.
 *
 * A cor vem do banco (`crm_tags.color`, `#rrggbb`) e o tema é claro OU escuro —
 * por isso a mistura com `currentColor`/`--foreground` em vez de um texto fixo:
 * um amarelo puro sobre fundo claro seria ilegível, e o mesmo chip precisa
 * servir aos dois temas sem uma cor de texto por tag.
 */
export function TagChip({
  nome,
  cor,
  tamanho = "md",
  className,
  children,
  title,
}: {
  nome: string;
  cor: string;
  tamanho?: "sm" | "md";
  className?: string;
  children?: ReactNode;
  title?: string;
}) {
  const estilo = {
    "--tag": cor,
    backgroundColor: "color-mix(in srgb, var(--tag) 14%, transparent)",
    borderColor: "color-mix(in srgb, var(--tag) 35%, transparent)",
    color: "color-mix(in srgb, var(--tag) 70%, var(--foreground))",
  } as CSSProperties;

  return (
    <span
      title={title ?? nome}
      style={estilo}
      data-tag={nome}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border font-medium leading-none",
        tamanho === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn("shrink-0 rounded-full", tamanho === "sm" ? "size-1.5" : "size-2")}
        style={{ backgroundColor: cor }}
      />
      <span className="truncate">{nome}</span>
      {children}
    </span>
  );
}
