"use client";
import type { Citation } from "@/lib/ai/citations/types";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { useT } from "@/hooks/i18n/useT";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  citations: Citation[];
  messageId?: string;
}

const SOURCE_LABEL: Record<string, string> = {
  faq: "Perguntas e respostas",
  documento: "Documento",
  policy: "Documento",
  conversas: "Conversa",
  conversation: "Conversa",
  conversations: "Conversa",
  catalogo: "Catálogo",
  catalog: "Catálogo",
  nuvemshop_catalog: "Catálogo",
};

/**
 * "Fonte: Tabela de preços 2026, trecho 3" — o atendente reconhece o material
 * pelo NOME que deu a ele no acervo. Citação antiga (sem nome gravado) cai no
 * tipo do material.
 */
export function rotuloDaFonte(c: Citation, t: (texto: string) => string): string | null {
  if (!c.source_name) return null;
  return typeof c.trecho === "number"
    ? t("Fonte: {nome}, trecho {n}").replace("{nome}", c.source_name).replace("{n}", String(c.trecho))
    : t("Fonte: {nome}").replace("{nome}", c.source_name);
}

export function CitationsPanel({
  open,
  onOpenChange,
  citations,
  messageId,
}: Props) {
  const t = useT();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t("Fontes da resposta")}</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-4 overflow-y-auto pr-2">
          {citations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("Esta resposta não usou nenhum trecho do material da empresa.")}
            </p>
          ) : (
            citations.map((c, i) => {
              const sourceLabel = c.source_type ? SOURCE_LABEL[c.source_type] : undefined;
              return (
              <div
                key={c.chunk_id ?? `cit-${i}`}
                className="rounded-md border p-3 text-sm"
              >
                <div className="mb-1 flex items-center justify-between">
                  <Badge variant="secondary">
                    {sourceLabel ? t(sourceLabel) : (c.source_type ?? t("Fonte"))}
                  </Badge>
                  {typeof c.score === "number" && (
                    <span className="text-xs text-muted-foreground">
                      {Math.round(c.score * 100)}%
                    </span>
                  )}
                </div>
                {rotuloDaFonte(c, t) && (
                  <p className="mb-1 text-xs font-medium" data-testid="citacao-fonte">
                    {rotuloDaFonte(c, t)}
                  </p>
                )}
                {c.source_anchor && (
                  <p className="mb-1 text-xs text-muted-foreground">
                    {c.source_anchor}
                  </p>
                )}
                {(c.snippet ?? c.text) && (
                  <p className="line-clamp-4 text-foreground/90">
                    {(c.snippet ?? c.text ?? "").slice(0, 200)}
                  </p>
                )}
              </div>
              );
            })
          )}
          {messageId && (
            <p className="pt-2 text-[10px] text-muted-foreground">
              message_id: {messageId}
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
