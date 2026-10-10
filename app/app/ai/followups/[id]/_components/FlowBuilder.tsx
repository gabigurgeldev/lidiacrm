"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";
import type { FollowupFlowDetailRow } from "@/hooks/followup/useFollowupFlow";

/**
 * @xyflow/react is a large dependency — this is the ONLY route that loads it.
 * `ssr:false` + dynamic import keeps it out of the main bundle entirely; see
 * the bundle delta note in the task report.
 */
const FlowCanvas = dynamic(() => import("./FlowCanvas").then((m) => m.FlowCanvas), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[600px] items-center justify-center p-6">
      <Skeleton className="h-full w-full" />
    </div>
  ),
});

interface Props {
  flowId: string;
  initialData: FollowupFlowDetailRow;
}

export function FlowBuilder({ flowId, initialData }: Props) {
  return (
    <div
      // Altura TRAVADA, a mesma do editor de fluxos (app/app/flows/[id]/_components/
      // FlowBuilder.tsx, onde a conta e a dívida estão explicadas). Com `h-full`,
      // a altura vinha do invólucro `max-w` do `AppShell`, que não tem altura: o
      // canvas resolvia para 0px e o React Flow — que mede 100% do pai — sumia.
      // Medido no e2e em 2026-10-09: a paleta aparecia e o quadro não, em
      // `followup-ramos` e `followup-linguagem` (`.react-flow` "hidden").
      className="flex h-[calc(100dvh-96px)] min-h-[600px] flex-1 flex-col lg:h-[calc(100dvh-104px)]"
      data-testid="flow-builder-shell"
    >
      <FlowCanvas flowId={flowId} initialData={initialData} />
    </div>
  );
}
