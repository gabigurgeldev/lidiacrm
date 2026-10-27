"use client";
import { TagChip } from "@/components/tags/TagChip";
import { useTags } from "@/hooks/tags/useTags";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/hooks/i18n/useT";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUser } from "@/hooks/auth/AuthProvider";
import { useBulkAction } from "@/hooks/kanban/useBulkAction";
import type { Stage } from "@/lib/kanban/types";

interface BulkActionBarProps {
  selectedIds: string[];
  stages: Stage[];
  pipelineId: string;
  onClear: () => void;
}

export function BulkActionBar({
  selectedIds,
  stages,
  pipelineId,
  onClear,
}: BulkActionBarProps) {
  const t = useT();
  const user = useUser();
  const bulk = useBulkAction(pipelineId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { data: catalogo } = useTags();

  // Esc to clear selection
  useEffect(() => {
    if (selectedIds.length === 0) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClear();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedIds.length, onClear]);

  if (selectedIds.length === 0) return null;

  const runMove = (stageId: string) => {
    bulk.mutate(
      {
        action: "move",
        lead_ids: selectedIds,
        params: { stage_id: stageId, position_in_stage: 1_000_000 },
      },
      { onSuccess: () => onClear() },
    );
  };

  const runAssign = (ownerId: string | null) => {
    bulk.mutate(
      {
        action: "assign",
        lead_ids: selectedIds,
        params: { owner_user_id: ownerId },
      },
      {
        onSuccess: (res) => {
          const n = res.data.updated_count;
          toast.success(
            ownerId === null
              ? `${n} lead${n > 1 ? "s" : ""} ${t("sem responsável.")}`
              : `${n} lead${n > 1 ? "s" : ""} ${t(n > 1 ? "atribuídos." : "atribuído.")}`,
          );
          onClear();
        },
      },
    );
  };

  // A tag vem do CATÁLOGO e vai para o CONTATO de cada negócio (migration
  // 0248) — a rota de massa usa o mesmo handler do PATCH do contato, então a
  // tag ligada a coluna também leva os contatos para lá.
  const runTagAdd = (nome: string) => {
    bulk.mutate(
      { action: "tag", lead_ids: selectedIds, params: { add: [nome] } },
      {
        onSuccess: (res) => {
          toast.success(`${t("Tag aplicada:")} ${nome} (${res.data.updated_count})`);
          onClear();
        },
      },
    );
  };

  const runDelete = () => {
    bulk.mutate(
      { action: "delete", lead_ids: selectedIds, params: {} },
      {
        onSuccess: () => {
          setConfirmDelete(false);
          onClear();
        },
      },
    );
  };

  return (
    <>
      {/* `w-fit` sozinho não tinha teto: seis itens (rótulo + 5 ações) numa
          linha só passavam da largura da tela em qualquer smartphone e essa
          barra `sticky` virava scroll horizontal da PÁGINA inteira — a barra
          é `mx-auto`, então o excesso ficava invisível dos dois lados, não só
          cortado. `max-w-[calc(100vw-2rem)]` + `flex-wrap` deixam a barra
          quebrar em linhas em vez de vazar. */}
      <div className="ios-vidro sticky bottom-4 z-30 mx-auto flex w-fit max-w-[calc(100vw-2rem)] flex-wrap items-center justify-center gap-2 rounded-full border border-border px-4 py-2 shadow-lg">
        <span className="text-sm font-medium">
          {selectedIds.length} {t(selectedIds.length > 1 ? "selecionados" : "selecionado")}
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" disabled={bulk.isPending}>
              {t("Mover para…")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>{t("Coluna")}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {stages.map((s) => (
              <DropdownMenuItem key={s.id} onClick={() => runMove(s.id)}>
                {s.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" disabled={bulk.isPending}>
              {t("Atribuir a…")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => runAssign(user.id)}>{t("Eu")}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => runAssign(null)}>
              {t("Remover responsável")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" disabled={bulk.isPending}>
              {t("Tag…")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
            <DropdownMenuLabel>{t("Aplicar tag nos contatos")}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {(catalogo ?? []).length === 0 ? (
              <DropdownMenuItem asChild>
                <a href="/app/tags">{t("Nenhuma tag criada ainda.")}</a>
              </DropdownMenuItem>
            ) : (
              (catalogo ?? []).map((tag) => (
                <DropdownMenuItem key={tag.id} onClick={() => runTagAdd(tag.name)}>
                  <TagChip nome={tag.name} cor={tag.color} tamanho="sm" />
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          size="sm"
          variant="destructive"
          onClick={() => setConfirmDelete(true)}
          disabled={bulk.isPending}
        >
          {t("Excluir")}
        </Button>

        <Button size="sm" variant="ghost" onClick={onClear}>
          {t("Cancelar")}
        </Button>
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("Excluir")} {selectedIds.length} lead(s)?
            </DialogTitle>
            <DialogDescription>
              {t("Esta ação remove os leads selecionados. Não pode ser desfeita.")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              {t("Cancelar")}
            </Button>
            <Button variant="destructive" onClick={runDelete} disabled={bulk.isPending}>
              {t("Excluir")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
