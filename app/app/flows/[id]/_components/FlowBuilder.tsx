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
    <div
      // Altura TRAVADA em vez de `h-full`/`flex-1` herdado do shell.
      //
      // `AppShell` (app/app/_components/AppShell.tsx) usa `min-h-screen` na
      // cadeia de ancestrais, não `h-screen` — `min-height` deixa a coluna
      // CRESCER além da viewport quando o conteúdo pede mais espaço, em vez de
      // travar em 100vh e delegar o excesso para o `overflow-auto` do
      // `<main>`. O sintoma medido é exatamente "a paleta não mostra tudo":
      // sem uma altura DEFINITIVA em algum ponto da cadeia, o `overflow-y-auto`
      // da paleta (FlowCanvas.tsx) nunca tem uma altura finita contra a qual
      // rolar, e o navegador rola a PÁGINA inteira em vez da paleta.
      //
      // `100dvh` menos o `h-14` do cabeçalho (components/shell/header/AppHeader.tsx,
      // 56px) e o `p-6` vertical do `<main>` (AppShell.tsx:44, 24px×2 = 48px):
      // 56 + 48 = 104px. Local a este editor de propósito — mudar `AppShell`
      // globalmente afetaria toda tela logada.
      className="flex h-[calc(100dvh-104px)] min-h-[500px] flex-1 flex-col"
      data-testid="construtor-de-fluxo"
    >
      <FlowCanvas flowId={flowId} />
    </div>
  );
}
