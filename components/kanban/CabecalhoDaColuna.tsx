"use client";
import { useState, type CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { TagChip } from "@/components/tags/TagChip";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import { useArquivarEtapa, useEditarEtapa } from "@/hooks/pipelines/useStages";
import { useTagsDaColuna, type TagDoCatalogo } from "@/hooks/tags/useTags";
import { ApiError } from "@/lib/api/types";
import { PALETA_DE_TAGS } from "@/lib/tags/normalizar";
import type { Stage } from "@/lib/kanban/types";
import { cn } from "@/lib/utils";
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  DotsThreeVertical,
  PencilSimple,
  Tag,
} from "@/lib/ui/icons";

function formatBRL(cents: number): string {
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `R$ ${(cents / 100).toFixed(0)}`;
  }
}

function textoDoErro(e: unknown, t: (s: string) => string): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return t("Não consegui completar essa ação. Tente de novo.");
}

/**
 * O topo de uma coluna do Kanban — e, para manager+, onde a coluna se edita.
 *
 * Antes, criar, renomear, reordenar e arquivar colunas só existia em
 * Configurações, longe do quadro: quem montava o Kanban editava às cegas e
 * voltava para conferir. Aqui a coluna se edita onde ela é vista. As regras
 * continuam nas MESMAS rotas (`/pipelines/[id]/stages/*`), com o mesmo
 * `requireRole("manager")` — o menu só aparece para quem a rota aceitaria.
 */
export function CabecalhoDaColuna({
  stage,
  stages,
  pipelineId,
  quantos,
  totalCents,
  tagsDaColuna,
  catalogo,
  podeGerenciar,
}: {
  stage: Stage;
  /** Todas as colunas ativas, na ordem — para mover e escolher destino. */
  stages: Stage[];
  pipelineId: string;
  quantos: number;
  totalCents: number;
  tagsDaColuna: TagDoCatalogo[];
  catalogo: TagDoCatalogo[];
  podeGerenciar: boolean;
}) {
  const t = useT();
  const qc = useQueryClient();
  const editar = useEditarEtapa(pipelineId);
  const arquivar = useArquivarEtapa(pipelineId);
  const definirTags = useTagsDaColuna();

  const [renomeando, setRenomeando] = useState<string | null>(null);
  const [escolhendoTags, setEscolhendoTags] = useState<Set<string> | null>(null);
  const [conflito, setConflito] = useState(false);
  /**
   * `negocios` é a contagem que o SERVIDOR devolveu no 422 (`precisa_destino`).
   * O quadro não sabe contar sozinho: com filtro ativo ele só vê parte dos
   * cards, e negócio fechado há mais de 30 dias nem chega ao quadro — a coluna
   * parecia vazia, o pedido ia sem destino e voltava recusado sem explicação.
   */
  const [arquivando, setArquivando] = useState<{ destino: string; negocios: number | null } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const reler = () => void qc.invalidateQueries({ queryKey: ["board", pipelineId] });
  const i = stages.findIndex((s) => s.id === stage.id);
  const destinos = stages.filter((s) => s.id !== stage.id && !s.is_won && !s.is_lost);

  function salvarNome() {
    const nome = (renomeando ?? "").trim();
    setRenomeando(null);
    if (!nome || nome === stage.name) return;
    editar.mutate(
      { stageId: stage.id, patch: { name: nome } },
      { onSettled: reler, onError: (e) => setErro(textoDoErro(e, t)) },
    );
  }

  function pintar(cor: string | null) {
    editar.mutate(
      { stageId: stage.id, patch: { color: cor } },
      { onSettled: reler, onError: (e) => setErro(textoDoErro(e, t)) },
    );
  }

  function mover(direcao: "esquerda" | "direita") {
    // `depois_de` é o vizinho da ESQUERDA depois do movimento (null = primeira).
    const depoisDe =
      direcao === "esquerda" ? (stages[i - 2]?.id ?? null) : (stages[i + 1]?.id ?? null);
    editar.mutate(
      { stageId: stage.id, patch: { depois_de: depoisDe } },
      { onSettled: reler, onError: (e) => setErro(textoDoErro(e, t)) },
    );
  }

  function salvarTags(mover = false) {
    if (!escolhendoTags) return;
    definirTags.mutate(
      { pipelineId, stageId: stage.id, tagIds: [...escolhendoTags], mover },
      {
        onSuccess: () => {
          setEscolhendoTags(null);
          setConflito(false);
        },
        onError: (e) => {
          if (e instanceof ApiError && e.code === "tag_already_linked_in_pipeline") setConflito(true);
          else setErro(textoDoErro(e, t));
        },
      },
    );
  }

  const negociosNaColuna = arquivando?.negocios ?? quantos;

  function confirmarArquivo() {
    arquivar.mutate(
      { stageId: stage.id, destinoId: negociosNaColuna > 0 ? (arquivando?.destino || null) : null },
      {
        onSuccess: () => setArquivando(null),
        onError: (e) => {
          const d = e instanceof ApiError ? (e.details as Record<string, unknown> | undefined) : undefined;
          if (d?.precisa_destino === true && typeof d.negocios === "number") {
            // A coluna tem negócios que o quadro não mostrava: pergunta o destino.
            setArquivando((a) => ({ destino: a?.destino || destinos[0]?.id || "", negocios: d.negocios as number }));
            return;
          }
          setArquivando(null);
          setErro(textoDoErro(e, t));
        },
        onSettled: reler,
      },
    );
  }

  const barra: CSSProperties = { backgroundColor: stage.color ?? "var(--color-border)" };

  return (
    <div className="flex flex-col gap-1.5 border-b border-border px-3 pb-2 pt-0">
      <span aria-hidden className="-mx-3 mb-1 h-1 rounded-t-lg" style={barra} />
      <div className="flex items-center gap-2">
        {renomeando !== null ? (
          <Input
            autoFocus
            value={renomeando}
            maxLength={80}
            onChange={(e) => setRenomeando(e.target.value)}
            onBlur={salvarNome}
            onKeyDown={(e) => {
              if (e.key === "Enter") salvarNome();
              if (e.key === "Escape") setRenomeando(null);
            }}
            className="h-7 flex-1 text-sm font-semibold"
            aria-label={t("Nome da coluna")}
            data-testid={`renomear-coluna-${stage.id}`}
          />
        ) : (
          <h2
            className={cn(
              "flex-1 truncate text-sm font-semibold text-text",
              podeGerenciar && "cursor-text",
            )}
            title={podeGerenciar ? t("Clique duas vezes para renomear") : stage.name}
            onDoubleClick={() => podeGerenciar && setRenomeando(stage.name)}
          >
            {stage.name}
          </h2>
        )}
        <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium tabular-nums text-text-muted">
          {quantos}
        </span>
        {podeGerenciar && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={`${t("Opções da coluna")} ${stage.name}`}
                data-testid={`menu-coluna-${stage.id}`}
              >
                <DotsThreeVertical size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setRenomeando(stage.name)}>
                <PencilSimple size={14} /> {t("Renomear")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setEscolhendoTags(new Set(tagsDaColuna.map((tg) => tg.id)))}
                data-testid={`tags-coluna-${stage.id}`}
              >
                <Tag size={14} /> {t("Tags da coluna")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <div className="px-2 py-1.5" role="group" aria-label={t("Cor da coluna")}>
                <span className="mb-1.5 block text-[11px] text-muted-foreground">{t("Cor da coluna")}</span>
                <div className="grid grid-cols-6 gap-1.5">
                  {PALETA_DE_TAGS.map((cor) => (
                    <button
                      key={cor}
                      type="button"
                      aria-label={cor}
                      aria-pressed={stage.color?.toLowerCase() === cor}
                      // O cinza da paleta é "sem cor": volta a coluna ao neutro.
                      onClick={() => pintar(cor === "#64748b" ? null : cor)}
                      className="size-5 rounded-full ring-offset-1 ring-offset-background transition-transform hover:scale-110 aria-pressed:ring-2 aria-pressed:ring-foreground"
                      style={{ backgroundColor: cor }}
                    />
                  ))}
                </div>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={i <= 0} onClick={() => mover("esquerda")}>
                <ArrowLeft size={14} /> {t("Mover para a esquerda")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={i >= stages.length - 1} onClick={() => mover("direita")}>
                <ArrowRight size={14} /> {t("Mover para a direita")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => setArquivando({ destino: destinos[0]?.id ?? "", negocios: null })}
              >
                <Archive size={14} /> {t("Arquivar coluna")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {totalCents > 0 && (
        <span className="text-[11px] tabular-nums text-text-muted">{formatBRL(totalCents)}</span>
      )}

      {tagsDaColuna.length > 0 && (
        <div className="flex flex-wrap gap-1" title={t("Aplicar uma destas tags num contato traz o negócio dele para esta coluna")}>
          {tagsDaColuna.map((tg) => (
            <TagChip key={tg.id} nome={tg.name} cor={tg.color} tamanho="sm" />
          ))}
        </div>
      )}

      {erro && (
        <p className="text-[11px] text-destructive" role="alert" onClick={() => setErro(null)}>
          {erro}
        </p>
      )}

      <Dialog open={escolhendoTags !== null} onOpenChange={(v) => !v && setEscolhendoTags(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("Tags da coluna")} «{stage.name}»
            </DialogTitle>
            <DialogDescription>
              {t("Aplicar uma destas tags num contato traz o negócio dele para esta coluna. Mover um card para cá dá as tags ao contato.")}
            </DialogDescription>
          </DialogHeader>
          {catalogo.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("Nenhuma tag criada ainda.")}{" "}
              <a className="underline" href="/app/tags">
                {t("Criar tags")}
              </a>
            </p>
          ) : (
            <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
              {catalogo.map((tg) => {
                const marcada = escolhendoTags?.has(tg.id) ?? false;
                const outra = tg.colunas.find((c) => c.pipeline_id === pipelineId && c.stage_id !== stage.id);
                return (
                  <li key={tg.id}>
                    <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted">
                      <input
                        type="checkbox"
                        checked={marcada}
                        onChange={() => {
                          setConflito(false);
                          setEscolhendoTags((atual) => {
                            const prox = new Set(atual ?? []);
                            if (prox.has(tg.id)) prox.delete(tg.id);
                            else prox.add(tg.id);
                            return prox;
                          });
                        }}
                      />
                      <TagChip nome={tg.name} cor={tg.color} tamanho="sm" />
                      {outra && (
                        <span className="ml-auto text-[11px] text-muted-foreground">
                          {t("hoje em")} {outra.stage_name}
                        </span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {conflito && (
            <p className="text-sm text-warning-fg" role="alert">
              {t("Uma tag escolhida já está em outra coluna deste Kanban. Trazer para esta coluna?")}
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setEscolhendoTags(null)}>
              {t("Cancelar")}
            </Button>
            <Button
              disabled={definirTags.isPending}
              onClick={() => salvarTags(conflito)}
              data-testid={`salvar-tags-coluna-${stage.id}`}
            >
              {conflito ? t("Trazer para esta coluna") : t("Salvar")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={arquivando !== null} onOpenChange={(v) => !v && setArquivando(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("Arquivar a coluna")} «{stage.name}»?
            </DialogTitle>
            <DialogDescription>
              {negociosNaColuna > 0
                ? `${negociosNaColuna} ${negociosNaColuna === 1 ? t("negócio está") : t("negócios estão")} ${t("nesta coluna. Para onde eles vão?")}`
                : t("A coluna está vazia e sai do quadro. O histórico dos negócios continua.")}
            </DialogDescription>
          </DialogHeader>
          {negociosNaColuna > 0 &&
            (destinos.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("Crie outra coluna antes de arquivar esta.")}</p>
            ) : (
              <select
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={arquivando?.destino ?? ""}
                onChange={(e) => setArquivando({ destino: e.target.value, negocios: arquivando?.negocios ?? null })}
              >
                {destinos.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            ))}
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setArquivando(null)}>
              {t("Cancelar")}
            </Button>
            <Button
              onClick={confirmarArquivo}
              variant="destructive"
              disabled={arquivar.isPending || (negociosNaColuna > 0 && !arquivando?.destino)}
            >
              {t("Arquivar")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
