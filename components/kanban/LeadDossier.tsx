"use client";

import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { tituloDoCard } from "@/lib/kanban/card-state";
import { useRef, useState } from "react";

import { useT } from "@/hooks/i18n/useT";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useLeadTimeline } from "@/hooks/leads/useLeadTimeline";
import type { Lead } from "@/lib/types/leads";
import { ConversaNoDossie } from "./ConversaNoDossie";
import { LeadFieldsForm } from "./LeadFieldsForm";
import { ScoreSlot } from "./ScoreSlot";
import { LeadTimeline } from "./LeadTimeline";
import { OwnerBadge, ownerInitials } from "./OwnerBadge";
import { LoseLeadDialog } from "./LoseLeadDialog";
import { TagChip } from "@/components/tags/TagChip";
import { Button } from "@/components/ui/button";
import { useTags } from "@/hooks/tags/useTags";
import { useWinLead } from "@/hooks/kanban/useUpdateLead";
import { formatarReais } from "@/lib/kanban/dinheiro";
import { tagsDoLead } from "@/lib/kanban/filters";
import { Trophy, XCircle } from "@/lib/ui/icons";
import { resolveLeadOwner } from "@/lib/kanban/owner";
import type { CustomFieldDef } from "@/components/contacts/CustomFieldsEditor";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  lead: Lead;
  pipelineId: string;
  fieldDefs?: CustomFieldDef[];
  stageName: string;
  ownerNames?: Map<string, string | null>;
}


/**
 * O dossiê do negócio: cabeçalho vivo → timeline → campos.
 *
 * A ORDEM É a mudança em relação ao diálogo de edição: quem abre um lead quer
 * primeiro saber O QUE ACONTECEU, e só depois mexer. O formulário íntegro fica
 * por último, e o cabeçalho tem um atalho para ele — ordem preservada, custo de
 * rolagem resolvido.
 *
 * SALVAR NÃO FECHA. Quem edita precisa ver a atividade que acabou de gerar
 * entrar na timeline; fechar esconderia o registro justamente de quem o
 * produziu, e a funcionalidade que prova "sua ação fica registrada" provaria
 * isso para todo mundo menos para o autor.
 */
export function LeadDossier({
  open,
  onOpenChange,
  lead,
  pipelineId,
  fieldDefs = [],
  stageName,
  ownerNames,
}: Props) {
  const tagDoIdioma = useTagDeIdioma();
  const t = useT();
  const campos = useRef<HTMLDivElement | null>(null);
  const timeline = useLeadTimeline(open ? lead.id : null, lead.contact_id);
  const owner = resolveLeadOwner(lead, ownerNames);
  const score = lead.score ?? null;
  const ganhar = useWinLead(pipelineId);
  const [perdendo, setPerdendo] = useState(false);
  const { data: catalogo } = useTags();
  const corDaTag = new Map((catalogo ?? []).map((tg) => [tg.name, tg.color]));
  const tags = tagsDoLead(lead);
  const nome = lead.contact_name ?? lead.title;
  // O mesmo nome que o card mostra (`tituloDoCard`): negócio automático lê o
  // nome vivo do contato, não a cópia gravada quando ele nasceu.
  const titulo = tituloDoCard(lead);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md"
        // Observável pelo mesmo motivo do board: "a assinatura morreu" e "nada
        // aconteceu" têm a mesma aparência, que é silêncio.
        data-realtime-status={timeline.realtimeStatus.toLowerCase()}
        // Observável como no board: "a entrega morreu" e "nada aconteceu"
        // têm a mesma aparência, e no dossiê a segunda é ainda mais crível —
        // negócio sem novidade é um estado normal.
        data-refetch-divergencias={timeline.seguranca.divergencias}
      >
        <SheetHeader className="pb-3">
          {/* Topo do dossiê: QUEM é (avatar + contato), O QUE é (título) e
              quanto vale — e as duas saídas do negócio à mão. Antes, ganhar ou
              perder só existia no menu ⋯ do card. */}
          <div className="flex items-start gap-3 pr-8">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
              {ownerInitials(nome)}
            </span>
            <div className="min-w-0 flex-1">
              {lead.contact_name && lead.contact_name !== titulo && (
                <p className="truncate text-xs font-medium text-text-muted">{lead.contact_name}</p>
              )}
              <SheetTitle className="text-base leading-6">{titulo}</SheetTitle>
              <p className="text-xl font-semibold tabular-nums tracking-tight text-text">
                {lead.value_cents != null ? formatarReais(lead.value_cents, lead.currency) : t("Sem valor")}
              </p>
            </div>
          </div>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-2">
              {tags.map((tag) => (
                <TagChip key={tag} nome={tag} cor={corDaTag.get(tag) ?? "#64748b"} tamanho="sm" />
              ))}
            </div>
          )}
          {lead.status === "open" && (
            <div className="flex gap-2 pt-3">
              <Button
                size="sm"
                className="flex-1 gap-1.5"
                disabled={ganhar.isPending}
                onClick={() => ganhar.mutate({ leadId: lead.id })}
                data-testid="dossie-ganhou"
              >
                <Trophy size={14} weight="fill" aria-hidden /> {t("Ganhou")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1 gap-1.5"
                onClick={() => setPerdendo(true)}
                data-testid="dossie-perdeu"
              >
                <XCircle size={14} aria-hidden /> {t("Perdeu")}
              </Button>
            </div>
          )}
        </SheetHeader>
        <LoseLeadDialog
          open={perdendo}
          onOpenChange={setPerdendo}
          leadId={lead.id}
          pipelineId={pipelineId}
        />

        {/* ① cabeçalho vivo */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border pb-3 text-xs">
          <span className="rounded-full bg-surface-elevated px-2 py-0.5 font-medium text-text">{stageName}</span>
          <OwnerBadge
            ownerKind={owner.kind}
            ownerName={owner.name}
            agentVersion={owner.agentVersion}
          />
          {score && (
            // O MESMO componente do card, não uma cópia do medidor.
            // "Superfície nova herda as decisões da antiga" só vale como
            // mecanismo: herdar por cópia é como as duas listas do evidence —
            // funciona hoje e diverge no mês em que alguém mudar um dos dois.
            // De brinde, o rótulo honesto da âncora ("registro que sustenta",
            // nunca "momento da conversa") vem junto, sem eu reescrever nada.
            <ScoreSlot
              probability={score.probability}
              band={score.band}
              reason={score.reason}
              factors={score.factors.slice(0, 3)}
            />
          )}

          <button
            type="button"
            onClick={() => campos.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
            className="ml-auto text-text-muted underline-offset-2 hover:text-text hover:underline"
          >
            {t("Editar campos")}
          </button>
        </div>

        {/* O score NÃO aparece na timeline: recálculo é telemetria e não emite
            atividade (silêncio para telemetria, pulso para mudança de estado).
            Sem esta linha, quem visse o número mudando no cabeçalho e nunca na
            timeline concluiria que a timeline está incompleta. */}
        {score?.at && (
          <p className="pt-2 text-[11px] text-text-muted">
            {t("Probabilidade recalculada automaticamente")} ·{" "}
            {new Date(score.at).toLocaleString(tagDoIdioma)}
          </p>
        )}

        <ConversaNoDossie conversa={lead.conversa} />

        {/* ② timeline */}
        <section className="flex-1 py-3">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
            {t("Linha do tempo")}
          </h3>
          <LeadTimeline
            itens={timeline.itens}
            chegouAoVivo={timeline.chegouAoVivo}
            isLoading={timeline.isLoading}
            isError={timeline.isError}
          />
        </section>

        {/* ③ campos, por último */}
        <div ref={campos} className="border-t border-border pt-3">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
            {t("Dados do negócio")}
          </h3>
          <LeadFieldsForm lead={lead} pipelineId={pipelineId} fieldDefs={fieldDefs} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
