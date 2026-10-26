"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import { useCriarEtapa } from "@/hooks/pipelines/useStages";
import { ApiError } from "@/lib/api/types";
import { Plus } from "@/lib/ui/icons";

/**
 * "+ Coluna" no fim do quadro (manager+). Usa a MESMA rota da tela de
 * Configurações (`POST /pipelines/[id]/stages`), que decide onde a coluna nasce
 * e recusa nome repetido com a explicação — que aparece aqui, debaixo do campo.
 */
export function NovaColuna({ pipelineId }: { pipelineId: string }) {
  const t = useT();
  const qc = useQueryClient();
  const criar = useCriarEtapa(pipelineId);
  const [nome, setNome] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  function salvar() {
    const n = (nome ?? "").trim();
    if (!n) {
      setNome(null);
      return;
    }
    setErro(null);
    criar.mutate(n, {
      onSuccess: () => setNome(null),
      onError: (e) => setErro(e instanceof ApiError ? e.message : t("Não consegui criar a coluna.")),
      onSettled: () => void qc.invalidateQueries({ queryKey: ["board", pipelineId] }),
    });
  }

  if (nome === null) {
    return (
      <button
        type="button"
        onClick={() => setNome("")}
        className="flex h-11 w-72 shrink-0 items-center justify-center gap-2 rounded-lg border border-dashed border-border text-sm font-medium text-text-muted transition-colors hover:border-border-strong hover:bg-surface-muted/40 hover:text-text"
        data-testid="nova-coluna"
      >
        <Plus size={16} /> {t("Nova coluna")}
      </button>
    );
  }

  return (
    <div className="flex w-72 shrink-0 flex-col gap-2 self-start rounded-lg border border-border bg-surface p-3">
      <Input
        autoFocus
        maxLength={80}
        placeholder={t("Nome da coluna")}
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") salvar();
          if (e.key === "Escape") setNome(null);
        }}
        data-testid="nome-da-nova-coluna"
      />
      {erro && (
        <p className="text-xs text-destructive" role="alert">
          {erro}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setNome(null)}>
          {t("Cancelar")}
        </Button>
        <Button size="sm" disabled={criar.isPending} onClick={salvar} data-testid="criar-coluna">
          {t("Criar coluna")}
        </Button>
      </div>
    </div>
  );
}
