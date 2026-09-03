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
      // `100dvh` menos o `h-14` do cabeçalho (56px) e o padding vertical do
      // `<main>` do `AppShell`.
      //
      // ⚠️ SÃO DOIS NÚMEROS, E O SEGUNDO MUDA COM A LARGURA. O `<main>` era
      // `p-6` (24px×2 = 48 → 104 no total) e o redesenho da navegação o trocou
      // por `py-5` abaixo de `lg` (20px×2 = 40 → 96) e `py-6` a partir de `lg`.
      // Enquanto esta linha dizia só `104px`, o editor media 8px A MAIS que o
      // espaço real em toda tela abaixo de 1024px — e quem paga uma altura
      // grande demais é o rodapé, que sai da tela.
      //
      // Uma soma escrita à mão sobre valores que moram em outro arquivo
      // envelhece assim, em silêncio. O Inbox saiu desse padrão de vez (virou
      // `h-full` sobre uma cadeia de flex — ver `InboxLayout.tsx`); aqui a
      // troca equivalente exigiria dar altura definida ao invólucro `max-w` do
      // `AppShell`, o que muda TODA tela logada. Fica o número certo, com as
      // duas faixas, e a dívida declarada.
      className="flex h-[calc(100dvh-96px)] min-h-[500px] flex-1 flex-col lg:h-[calc(100dvh-104px)]"
      data-testid="construtor-de-fluxo"
    >
      <FlowCanvas flowId={flowId} />
    </div>
  );
}
