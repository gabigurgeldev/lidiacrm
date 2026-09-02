"use client";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Sidebar } from "@/components/shell/Sidebar";
import { AppHeader } from "@/components/shell/header/AppHeader";
import { useInboundMessageAlerts } from "@/hooks/notifications/useInboundMessageAlerts";
import { useCrmAlerts } from "@/hooks/notifications/useCrmAlerts";
import { useNotifyOpenFromServiceWorker } from "@/lib/notifications/notify_open";
import { cabecalhoEscondidoEm } from "@/lib/navigation/casca";
import type { NavGroupId } from "@/lib/navigation/registry";
import { cn } from "@/lib/utils";

interface AppShellProps {
  sidebarCollapsed: boolean;
  /** O cookie dos grupos, lido no SSR — ver `lib/navigation/grupos-abertos.ts`. */
  gruposAbertosSalvos: NavGroupId[] | null;
  children: ReactNode;
}

export function AppShell({ sidebarCollapsed, gruposAbertosSalvos, children }: AppShellProps) {
  useInboundMessageAlerts();
  useCrmAlerts();
  useNotifyOpenFromServiceWorker();
  const pathname = usePathname();
  // A regra mora em `lib/navigation/casca.ts` porque o rodapé da barra lateral
  // precisa da MESMA resposta — ele adota as ações de conta que o cabeçalho
  // deixa órfãs. Duas cópias divergindo não dariam erro: dariam o sino e o
  // avatar duas vezes na tela, ou nenhuma.
  const semCabecalho = cabecalhoEscondidoEm(pathname);

  return (
    /*
      `h-dvh` + `overflow-hidden`, e não `min-h-screen`.
      ⚠️ ESTA LINHA É O CONSERTO DE UMA CLASSE INTEIRA DE DEFEITO, não um ajuste.

      O `InboxLayout` calculava a própria altura com
      `calc(100dvh - 3.5rem - 2*var(--space-6))` — a viewport menos o cabeçalho,
      menos o padding deste `<main>`. Uma soma escrita à mão que precisava
      acompanhar toda mudança de padding daqui, em outro arquivo, sem nada
      ligando os dois. O redesenho da navegação trocou o `p-6` uniforme por
      `py-5` abaixo de `lg`, e a grade do inbox passou a medir 8px A MAIS que o
      espaço real — quem pagava era o composer, no rodapé, exatamente na hora de
      escrever.

      Com a casca em altura fixa e `min-h-0` na coluna, `flex-1` no `<main>` já
      é "o que sobrou", e o filho pede `h-full`. Não há mais soma para envelhecer.

      `dvh` e não `vh`: no celular a `vh` ignora a barra do navegador — o mesmo
      corte, só que mudando conforme se rola.
    */
    <div className="flex h-dvh w-full overflow-hidden bg-background">
      <div className="hidden md:block">
        <Sidebar collapsed={sidebarCollapsed} gruposAbertosSalvos={gruposAbertosSalvos} />
      </div>
      {/*
        `min-w-0` é o que permite a coluna de conteúdo ENCOLHER. Um flex item
        nasce com `min-width: auto`, ou seja, nunca fica menor que o conteúdo —
        então qualquer bloco largo (uma fila de abas, uma tabela) empurrava a
        PÁGINA INTEIRA para o lado em vez de rolar dentro da própria caixa, e o
        conteúdo sumia sem nada indicando que existia.

        Medido em 390x844 no detalhe do agente, que tem seis abas: a página
        estourava 476px na horizontal; com esta classe, 212px — o que sobra é o
        cabeçalho, presente também em telas que não têm abas (a lista de agentes
        estoura 236px). Isolado ancestral por ancestral: é este o que decide.

        `min-h-0` é o irmão vertical dele, e sem ele o `overflow-auto` do
        `<main>` não tem contra o quê medir: a coluna cresce com o conteúdo e a
        rolagem vaza para fora da tela.
      */}
      {/*
        Sem `md:ml-*`: a barra voltou a ocupar lugar na linha (ver o comentário
        em `sidebar/AppSidebar.tsx`), então o que sobra para esta coluna é
        exatamente o que ela não usou. A margem existia para compensar uma barra
        `fixed`, e era a SEGUNDA medida da mesma coisa — a que discordava e
        deixava a barra por cima da lista.
      */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/*
          ⚠️ `md:hidden` E NÃO REMOVER O CABEÇALHO: no celular ele FICA, mesmo no
          Inbox. O botão ☰ que abre a gaveta de navegação mora dentro dele, e a
          barra lateral é `hidden md:block` — tirá-lo ali deixaria as vinte telas
          do produto alcançáveis só digitando a URL.

          O corte é de CSS, não de JavaScript: `matchMedia` só responde depois da
          hidratação, e estrutura decidida assim pisca no primeiro render.
        */}
        <div
          data-testid="cabecalho-do-app"
          // O atributo existe para o TESTE poder perguntar "esta tela manda o
          // cabeçalho sumir?" sem depender de CSS — o jsdom não aplica folha de
          // estilo, então `md:hidden` é invisível para ele. A classe é quem
          // esconde; isto só declara a intenção, no mesmo lugar.
          data-some-em-md={semCabecalho ? "true" : undefined}
          className={cn(semCabecalho && "md:hidden")}
        >
          <AppHeader gruposAbertosSalvos={gruposAbertosSalvos} />
        </div>
        <main
          className={cn(
            "min-h-0 flex-1 overflow-auto",
            // A tela que dispensa o cabeçalho é de borda a borda. Margem aqui
            // deixaria a conversa flutuando numa moldura, que é o oposto de
            // parecer um aplicativo de mensagens.
            !semCabecalho && "px-4 py-5 sm:px-6 lg:px-8 lg:py-6",
          )}
        >
          {/*
            `max-w` na coluna de conteúdo, e não na página: numa tela de 2560px o
            conteúdo ia de ponta a ponta e a linha de leitura de qualquer texto
            passava dos 200 caracteres. O `mx-auto` centra o que sobra.

            O Inbox fica FORA dessa caixa: ele é uma grade de três colunas que
            quer toda a largura, e um `max-w` no meio do caminho deixaria faixas
            vazias dos dois lados de uma conversa.
          */}
          {semCabecalho ? (
            <div className="h-full">{children}</div>
          ) : (
            <div className="mx-auto w-full max-w-[1600px]">{children}</div>
          )}
        </main>
      </div>
    </div>
  );
}
