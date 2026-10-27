"use client";
import { useMemo, useState } from "react";
import Link from "next/link";

import { TagChip } from "@/components/tags/TagChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useT } from "@/hooks/i18n/useT";
import { useTags } from "@/hooks/tags/useTags";
import { Plus, X } from "@/lib/ui/icons";

interface Props {
  /** Nomes das tags escolhidas — o contato guarda NOMES (`contacts.tags text[]`). */
  valor: string[];
  aoMudar: (proximas: string[]) => void;
  desabilitado?: boolean;
  /** Testid do botão "Adicionar tag": o inbox e um diálogo podem estar na mesma tela. */
  testIdDoBotao?: string;
}

/** O teto do schema do contato (`contactPatchSchema`). */
const MAXIMO_DE_TAGS = 20;

/**
 * Escolher tags DO CATÁLOGO, com cor — o único jeito de pôr tag em contato.
 *
 * Os diálogos de novo/editar contato ainda tinham "Tags (separadas por
 * vírgula)": cada um digitava a sua grafia, a tag não existia no catálogo e
 * por isso não levava o contato a coluna nenhuma nem casava com o filtro do
 * inbox. Tag que o contato já tem e que não está no catálogo (legado do campo
 * livre) continua aparecendo, em cinza, e dá para tirar.
 */
export function SeletorDeTags({ valor, aoMudar, desabilitado, testIdDoBotao = "adicionar-tag" }: Props) {
  const t = useT();
  const { data: catalogo, isLoading } = useTags();
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState(false);

  const corDe = useMemo(() => new Map((catalogo ?? []).map((tg) => [tg.name, tg.color])), [catalogo]);
  const disponiveis = useMemo(() => {
    const q = busca.trim().toLocaleLowerCase("pt-BR");
    return (catalogo ?? []).filter(
      (tg) => !valor.includes(tg.name) && (!q || tg.name.toLocaleLowerCase("pt-BR").includes(q)),
    );
  }, [catalogo, valor, busca]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {valor.length > 0 ? (
          valor.map((tag) => (
            <TagChip key={tag} nome={tag} cor={corDe.get(tag) ?? "#64748b"} tamanho="sm">
              <button
                type="button"
                onClick={() => aoMudar(valor.filter((v) => v !== tag))}
                disabled={desabilitado}
                aria-label={`${t("Remover tag")} ${tag}`}
                className="-mr-0.5 rounded-sm opacity-70 hover:opacity-100"
              >
                <X size={10} weight="bold" aria-hidden />
              </button>
            </TagChip>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">{t("Sem tags no contato.")}</span>
        )}
      </div>

      <Popover open={aberto} onOpenChange={setAberto}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-xs"
            disabled={desabilitado || valor.length >= MAXIMO_DE_TAGS}
            data-testid={testIdDoBotao}
          >
            <Plus size={12} aria-hidden /> {t("Adicionar tag")}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-2">
          <Input
            autoFocus
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder={t("Buscar tag")}
            className="mb-2 h-8 text-xs"
            aria-label={t("Buscar tag")}
          />
          <ul className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
            {isLoading ? (
              <li className="px-2 py-1 text-xs text-muted-foreground">{t("Carregando…")}</li>
            ) : disponiveis.length === 0 ? (
              <li className="px-2 py-1 text-xs text-muted-foreground">
                {(catalogo ?? []).length === 0
                  ? t("Nenhuma tag criada ainda.")
                  : t("Nenhuma tag com esse nome.")}
              </li>
            ) : (
              disponiveis.map((tg) => (
                <li key={tg.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setAberto(false);
                      setBusca("");
                      aoMudar([...valor, tg.name]);
                    }}
                    className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
                    data-testid={`opcao-tag-${tg.name}`}
                  >
                    <TagChip nome={tg.name} cor={tg.color} tamanho="sm" />
                    {tg.colunas.length > 0 && (
                      <span
                        className="truncate text-[10px] text-muted-foreground"
                        title={tg.colunas.map((c) => `${c.pipeline_name} › ${c.stage_name}`).join(", ")}
                      >
                        → {tg.colunas[0]!.pipeline_name}
                        {tg.colunas.length > 1 ? ` +${tg.colunas.length - 1}` : ""}
                      </span>
                    )}
                  </button>
                </li>
              ))
            )}
          </ul>
          <Link
            href="/app/tags"
            className="mt-2 block border-t border-border px-2 pt-2 text-[11px] text-muted-foreground hover:text-foreground"
          >
            {t("Gerenciar tags")}
          </Link>
        </PopoverContent>
      </Popover>
    </div>
  );
}
