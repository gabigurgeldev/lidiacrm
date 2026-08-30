"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";

/**
 * `@xyflow/react` é uma dependência grande, e o repo carrega ela em ROTAS
 * CONTADAS de propósito (o construtor de follow-up é a outra). `ssr:false` +
 * import dinâmico a mantêm fora do bundle principal — sem isto, todo mundo que
 * abre o Inbox baixa o canvas que nunca vai usar.
 */
const FlowCanvas = dynamic(() => import("./FlowCanvas").then((m) => m.FlowCanvas), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[600px] items-center justify-center p-6">
      <Skeleton className="h-full w-full" />
    </div>
  ),
});

export function FlowBuilder({ flowId }: { flowId: string }) {
  return (
    <div className="flex h-full min-h-[600px] flex-1 flex-col" data-testid="construtor-de-fluxo">
      <FlowCanvas flowId={flowId} />
    </div>
  );
}
