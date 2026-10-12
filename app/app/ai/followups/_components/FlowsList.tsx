"use client";

import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";

import { useT } from "@/hooks/i18n/useT";
import { useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Grupo } from "@/components/ajustes";
import { FlowArrow, Plus } from "@/lib/ui/icons";
import { useFollowupFlows, type FollowupFlowPointerRow } from "@/hooks/followup/useFollowupFlows";
import { DeleteFollowupFlowButton } from "./DeleteFollowupFlowButton";
import { FlowStatusBadge } from "./FlowStatusBadge";
import { NewFlowDialog } from "./NewFlowDialog";

interface Props {
  initialData: FollowupFlowPointerRow[];
  canWrite: boolean;
}

function formatUpdatedAt(iso: string, idioma: string): string {
  return new Date(iso).toLocaleDateString(idioma, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function FlowsList({ initialData, canWrite }: Props) {
  const tagDoIdioma = useTagDeIdioma();
  const t = useT();
  const { data } = useFollowupFlows({ initialData });
  const [dialogOpen, setDialogOpen] = useState(false);

  const flows = data ?? [];

  const newFlowButton = (
    <Button onClick={() => setDialogOpen(true)} className="w-full sm:w-auto">
      <Plus size={14} aria-hidden className="mr-2" /> Novo fluxo
    </Button>
  );

  if (flows.length === 0) {
    return (
      <>
        <div className="ios-grupo flex flex-col items-center gap-3 p-10 text-center">
          <FlowArrow size={36} aria-hidden className="text-text-muted" />
          <h2 className="font-medium">{t("Nenhum fluxo de follow-up ainda")}</h2>
          <p className="max-w-sm text-sm text-text-muted">
            {t(
              "Follow-ups reengajam contatos após silêncio, mudança de etapa, uma regra em Webhooks ou a resposta do contato — sem depender de alguém lembrar de mandar mensagem.",
            )}
          </p>
          {canWrite && <div className="mt-1">{newFlowButton}</div>}
        </div>
        {canWrite && <NewFlowDialog open={dialogOpen} onOpenChange={setDialogOpen} />}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {canWrite && (
        <div className="flex sm:justify-end">{newFlowButton}</div>
      )}

      {/* No kit de Ajustes: uma lista agrupada, uma linha por fluxo. */}
      <Grupo>
        {flows.map((flow) => (
          <div key={flow.id} className="ios-linha gap-3">
            <Link href={`/app/ai/followups/${flow.id}`} className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex items-center gap-2">
                <span className="min-w-0 truncate text-sm font-medium" title={flow.name}>
                  {flow.name}
                </span>
                <FlowStatusBadge status={flow.status} />
              </span>
              <span className="text-xs text-text-muted">
                {t("Versão")}: <span className="font-mono">{flow.active_version_id ? "publicada" : "—"}</span>
                {" · "}Handoff: <span className="font-mono">{flow.handoff_policy}</span>
                {" · "}Atualizado em {formatUpdatedAt(flow.updated_at, tagDoIdioma)}
              </span>
            </Link>
            {canWrite && <DeleteFollowupFlowButton flowId={flow.id} flowName={flow.name} />}
          </div>
        ))}
      </Grupo>

      {canWrite && <NewFlowDialog open={dialogOpen} onOpenChange={setDialogOpen} />}
    </div>
  );
}
