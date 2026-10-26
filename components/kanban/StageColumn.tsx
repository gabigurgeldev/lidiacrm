"use client";
import { Droppable } from "@hello-pangea/dnd";
import { useState } from "react";
import { useT } from "@/hooks/i18n/useT";
import { cn } from "@/lib/utils";
import type { Lead } from "@/lib/types/leads";
import type { Stage } from "@/lib/kanban/types";
import type { TagDoCatalogo } from "@/lib/tags/tipos";
import { buildCardInput } from "@/lib/kanban/card-state";
import { CabecalhoDaColuna } from "./CabecalhoDaColuna";
import { KanbanCard } from "./KanbanCard";

/**
 * Quantos cards a coluna desenha antes do "Mostrar mais".
 *
 * Coluna com 400 negócios desenhava 400 cards, cada um com seus slots — e o
 * arrasto (que mede todos os Draggables da lista) engasgava. Os primeiros 50
 * são os do topo da ordem do quadro, que é onde se trabalha; o resto aparece
 * sob demanda. Busca e filtro rodam sobre TODOS os leads, antes deste corte.
 */
export const CARDS_POR_PAGINA = 50;

interface StageColumnProps {
  stage: Stage;
  /** Todas as colunas ativas, na ordem do quadro (mover, destino ao arquivar). */
  stages: Stage[];
  leads: Lead[];
  pipelineId: string;
  /** owner_user_id → nome, resolvido no board. O dono agente vem no lead. */
  ownerNames?: Map<string, string | null>;
  /** ids que o radar classificou como esfriando (fonte única, não recalculada). */
  coolingIds?: Set<string>;
  /** Propostas de retomada vivas, por lead. */
  reactivations?: Map<string, { proposalId: string; expiresAt: string }>;
  /** `settings.canonical_tags` do pipeline — o ponto ao lado do título. */
  canonicalTags?: string[];
  selectedLeadIds?: Set<string>;
  /** leadId → quantos eventos remotos já chegaram (muda = pulsa de novo). */
  pulses?: Map<string, number>;
  onSelect?: (leadId: string, additive: boolean) => void;
  /** Abrir o dossiê — atravessa o board até o card, como `pulses`. */
  onOpen?: (leadId: string) => void;
  /** Catálogo de tags (migration 0248) e as vinculadas a ESTA coluna. */
  catalogo?: TagDoCatalogo[];
  tagsDaColuna?: TagDoCatalogo[];
  coresDasTags?: Map<string, string>;
  /** Espelha o `requireRole("manager")` das rotas de etapa. */
  podeGerenciar?: boolean;
}

export function StageColumn({
  stage,
  stages,
  leads,
  pipelineId,
  ownerNames,
  coolingIds,
  reactivations,
  canonicalTags,
  selectedLeadIds,
  pulses,
  onSelect,
  onOpen,
  catalogo = [],
  tagsDaColuna = [],
  coresDasTags,
  podeGerenciar = false,
}: StageColumnProps) {
  const t = useT();
  const [paginas, setPaginas] = useState(1);
  const totalCents = leads.reduce((sum, l) => sum + (l.value_cents ?? 0), 0);
  const visiveis = leads.slice(0, paginas * CARDS_POR_PAGINA);
  const restantes = leads.length - visiveis.length;

  return (
    <div
      className="flex w-80 shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-surface-muted/40"
      data-testid={`coluna-${stage.id}`}
    >
      <CabecalhoDaColuna
        stage={stage}
        stages={stages}
        pipelineId={pipelineId}
        quantos={leads.length}
        totalCents={totalCents}
        tagsDaColuna={tagsDaColuna}
        catalogo={catalogo}
        podeGerenciar={podeGerenciar}
      />

      <Droppable droppableId={stage.id} type="LEAD">
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={cn(
              "flex flex-1 flex-col gap-2 overflow-y-auto p-2 transition-colors",
              snapshot.isDraggingOver && "bg-accent/5 ring-1 ring-inset ring-accent/30",
            )}
          >
            {visiveis.map((lead, idx) => (
              <KanbanCard
                key={lead.id}
                card={buildCardInput(lead, {
                  stageName: stage.name,
                  ownerNames,
                  coolingIds,
                  reactivations,
                  canonicalTags,
                })}
                lead={lead}
                index={idx}
                pipelineId={pipelineId}
                isSelected={selectedLeadIds?.has(lead.id)}
                pulseCount={pulses?.get(lead.id) ?? 0}
                onSelect={onSelect}
                onOpen={onOpen}
                coresDasTags={coresDasTags}
              />
            ))}
            {provided.placeholder}
            {restantes > 0 && (
              <button
                type="button"
                onClick={() => setPaginas((p) => p + 1)}
                className="rounded-md border border-dashed border-border py-2 text-xs font-medium text-text-muted hover:border-border-strong hover:text-text"
                data-testid={`mostrar-mais-${stage.id}`}
              >
                {t("Mostrar mais")} ({restantes})
              </button>
            )}
            {leads.length === 0 && !snapshot.isDraggingOver && (
              <div className="flex h-20 items-center justify-center rounded-md border border-dashed border-border text-[11px] text-text-muted/70">
                {t("Arraste um card para cá")}
              </div>
            )}
          </div>
        )}
      </Droppable>
    </div>
  );
}
