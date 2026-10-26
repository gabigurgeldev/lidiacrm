"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/hooks/i18n/useT";
import { useColocarNaColuna, useKanbansDoContato } from "@/hooks/kanban/useKanbansDoContato";
import { ApiError } from "@/lib/api/types";
import { Kanban, Plus } from "@/lib/ui/icons";

/**
 * "Em que fase de cada Kanban este contato está?" — respondido e editável na
 * conversa.
 *
 * Uma linha por Kanban onde o contato tem negócio aberto, com a coluna num
 * seletor: trocar a coluna move o negócio. "Colocar em um Kanban" escolhe
 * Kanban e coluna; se o contato já tem negócio ali o servidor move, se não
 * tem, cria (`lib/leads/contato-no-kanban.ts`) — o atendente nunca precisa
 * saber a diferença, e nunca ganha card duplicado por clicar duas vezes.
 */
export function KanbansDoContato({ contactId }: { contactId: string }) {
  const t = useT();
  const { data, isLoading, isError, refetch } = useKanbansDoContato(contactId);
  const colocar = useColocarNaColuna(contactId);
  const [novo, setNovo] = useState<{ kanbanId: string; stageId: string } | null>(null);

  const kanbanPorId = useMemo(() => new Map((data?.kanbans ?? []).map((k) => [k.id, k])), [data]);

  function mover(stageId: string) {
    colocar.mutate(stageId, {
      onSuccess: (r) => {
        const k = kanbanPorId.get(r.pipeline_id);
        const coluna = k?.stages.find((s) => s.id === r.stage_id)?.name ?? "";
        if (r.acao !== "ja_estava") toast.success(`${t("Contato no Kanban")} ${k?.name ?? ""} › ${coluna}`);
        if (r.tags_da_coluna.length > 0) {
          toast.message(`${t("Tags aplicadas pela coluna:")} ${r.tags_da_coluna.join(", ")}`);
        }
        setNovo(null);
      },
      onError: (e) => toast.error(e instanceof ApiError ? e.message : t("Não consegui mover o contato.")),
    });
  }

  if (isLoading) return <Skeleton className="mt-2 h-16 w-full" />;
  if (isError || !data) {
    return (
      <p className="mt-2 text-xs text-destructive">
        {t("Não consegui ler os Kanbans.")}{" "}
        <button type="button" className="underline" onClick={() => void refetch()}>
          {t("Tentar de novo")}
        </button>
      </p>
    );
  }
  if (data.kanbans.length === 0) {
    return <p className="mt-2 text-xs text-muted-foreground">{t("Nenhum Kanban criado ainda.")}</p>;
  }

  const kanbanDoNovo = novo ? kanbanPorId.get(novo.kanbanId) : undefined;

  return (
    <div className="mt-2 flex flex-col gap-2" data-testid="kanbans-do-contato">
      {data.negocios.length === 0 && (
        <p className="text-xs text-muted-foreground">{t("O contato ainda não está em nenhum Kanban.")}</p>
      )}
      {data.negocios.map((n) => {
        const k = kanbanPorId.get(n.pipeline_id);
        if (!k) return null;
        const atual = k.stages.find((s) => s.id === n.stage_id);
        return (
          <div key={n.id} className="flex items-center gap-2 rounded-lg border border-border p-2">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: atual?.color ?? "var(--color-border-strong)" }}
            />
            <Link
              href={`/app/pipelines/${k.id}?lead=${n.id}`}
              className="min-w-0 flex-1 truncate text-xs font-medium hover:underline"
              title={n.title}
            >
              {k.name}
            </Link>
            <select
              aria-label={`${t("Coluna em")} ${k.name}`}
              className="h-7 max-w-[55%] rounded-md border border-input bg-background px-1.5 text-xs"
              value={n.stage_id}
              disabled={colocar.isPending}
              onChange={(e) => mover(e.target.value)}
              data-testid={`coluna-do-contato-${k.id}`}
            >
              {k.stages
                // Ganho/perda fecham o negócio — isso se faz no quadro, com motivo.
                .filter((s) => (!s.is_won && !s.is_lost) || s.id === n.stage_id)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </div>
        );
      })}

      {novo ? (
        <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border p-2">
          <select
            aria-label={t("Kanban")}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            value={novo.kanbanId}
            onChange={(e) => {
              const k = kanbanPorId.get(e.target.value);
              setNovo({ kanbanId: e.target.value, stageId: k?.stages.find((s) => !s.is_won && !s.is_lost)?.id ?? "" });
            }}
            data-testid="novo-kanban-do-contato"
          >
            {data.kanbans.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
          <select
            aria-label={t("Coluna")}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            value={novo.stageId}
            onChange={(e) => setNovo({ ...novo, stageId: e.target.value })}
            data-testid="nova-coluna-do-contato"
          >
            {(kanbanDoNovo?.stages ?? [])
              .filter((s) => !s.is_won && !s.is_lost)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setNovo(null)}>
              {t("Cancelar")}
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={!novo.stageId || colocar.isPending}
              onClick={() => mover(novo.stageId)}
              data-testid="confirmar-kanban-do-contato"
            >
              {t("Colocar")}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="h-7 w-fit gap-1 px-2 text-xs"
          onClick={() => {
            const k = data.kanbans.find((x) => x.is_default) ?? data.kanbans[0]!;
            setNovo({ kanbanId: k.id, stageId: k.stages.find((s) => !s.is_won && !s.is_lost)?.id ?? "" });
          }}
          data-testid="colocar-em-kanban"
        >
          <Plus size={12} aria-hidden />
          <Kanban size={12} aria-hidden /> {t("Colocar em um Kanban")}
        </Button>
      )}
    </div>
  );
}
