"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { TagChip } from "@/components/tags/TagChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useUpdateContact } from "@/hooks/contacts/useUpdateContact";
import { useT } from "@/hooks/i18n/useT";
import { chaveDosKanbansDoContato } from "@/hooks/kanban/useKanbansDoContato";
import { useTags } from "@/hooks/tags/useTags";
import { Plus, X } from "@/lib/ui/icons";

interface Props {
  contactId: string;
  tags: string[];
}

/** O que o PATCH do contato devolve quando a tag mexeu num Kanban (`lib/tags/tag-no-kanban.ts`). */
interface EfeitoNoKanban {
  pipeline_name: string;
  stage_name: string;
  acao: "criado" | "movido" | "ja_estava" | "ambiguo" | "falhou";
}

/**
 * As tags do CONTATO, escolhidas do catálogo (migration 0248).
 *
 * Antes era um campo de texto livre: cada atendente digitava a sua grafia e o
 * filtro do inbox nunca casava. Agora se escolhe de uma lista com cor; criar
 * tag nova é na página Tags (manager+). Tag aplicada que está ligada a uma
 * coluna de Kanban leva o contato para lá — e a tela diz para onde.
 */
export function ContactTagsEditor({ contactId, tags }: Props) {
  const t = useT();
  const qc = useQueryClient();
  const mutation = useUpdateContact(contactId);
  const { data: catalogo, isLoading } = useTags();
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState(false);

  const corDe = useMemo(() => new Map((catalogo ?? []).map((tg) => [tg.name, tg.color])), [catalogo]);
  const disponiveis = useMemo(() => {
    const q = busca.trim().toLocaleLowerCase("pt-BR");
    return (catalogo ?? []).filter(
      (tg) => !tags.includes(tg.name) && (!q || tg.name.toLocaleLowerCase("pt-BR").includes(q)),
    );
  }, [catalogo, tags, busca]);

  function aplicar(next: string[]) {
    mutation.mutate(
      { tags: next },
      {
        onSuccess: (r) => {
          const efeitos = (r.data as { kanban_efeitos?: EfeitoNoKanban[] }).kanban_efeitos ?? [];
          for (const e of efeitos) {
            if (e.acao === "criado" || e.acao === "movido") {
              toast.success(`${t("Contato no Kanban")} ${e.pipeline_name} › ${e.stage_name}`);
            } else if (e.acao === "ambiguo") {
              toast.warning(
                `${e.pipeline_name}: ${t("o contato tem mais de um negócio aberto — mova pelo quadro.")}`,
              );
            } else if (e.acao === "falhou") {
              toast.error(`${e.pipeline_name}: ${t("não consegui mover o negócio.")}`);
            }
          }
          if (efeitos.length > 0) {
            void qc.invalidateQueries({ queryKey: chaveDosKanbansDoContato(contactId) });
          }
          // As tags do contato aparecem no CARD de todo Kanban onde ele está, e o
          // Realtime do quadro só escuta crm_leads — sem isto o card mostrava a
          // tag velha até alguém mexer no negócio.
          void qc.invalidateQueries({ queryKey: ["board"] });
        },
      },
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-md border border-border p-2" data-testid="tags-do-contato">
      <div className="flex flex-wrap gap-1">
        {tags.length > 0 ? (
          tags.map((tag) => (
            <TagChip key={tag} nome={tag} cor={corDe.get(tag) ?? "#64748b"} tamanho="sm">
              <button
                type="button"
                onClick={() => aplicar(tags.filter((v) => v !== tag))}
                disabled={mutation.isPending}
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
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-xs"
            disabled={mutation.isPending || tags.length >= 20}
            data-testid="adicionar-tag-ao-contato"
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
                      aplicar([...tags, tg.name]);
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
