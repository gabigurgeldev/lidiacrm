"use client";
import { useTransition } from "react";

import { toggleSidebar } from "@/app/actions/shell/toggleSidebar";
import { AlertsBell } from "@/components/shell/AlertsBell";
import { VersionFooter } from "@/components/shell/VersionFooter";
import { ContaNaBarra } from "@/components/shell/sidebar/ContaNaBarra";
import { SidebarItem } from "@/components/shell/sidebar/SidebarItem";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/hooks/i18n/useT";
import { cn } from "@/lib/utils";
import { CaretDoubleLeft, CaretDoubleRight, Gear } from "@/lib/ui/icons";
import { GRUPO_NO_RODAPE, NAV_GROUPS } from "@/lib/navigation/registry";

interface SidebarFooterProps {
  collapsed: boolean;
  /**
   * O SINO — e só ele — depende de a tela ter cabeçalho.
   *
   * ⚠️ ESTA PROP ENCOLHEU. Ela se chamava `mostrarAcoesDeConta` e carregava
   * quatro peças (sino, idioma, tema, avatar) que moravam no cabeçalho e ficavam
   * órfãs no Inbox, onde a casca não o desenha (`lib/navigation/casca.ts`).
   * Hoje a CONTA mora aqui em toda rota e o idioma e o tema não existem mais
   * como peça de casca, então o que sobra de condicional é o aviso.
   *
   * ⚠️ UM LUGAR DE CADA VEZ, nunca os dois: quem decide é a MESMA função que a
   * casca consulta para não desenhar o cabeçalho. Duas regras separadas não
   * dariam erro — dariam o sino duas vezes, ou nenhuma, em silêncio. Medido nas
   * duas pontas por `tests/unit/casca-esconde-o-cabecalho.test.tsx`.
   */
  mostrarAvisos?: boolean;
  compacto: boolean;
  pathname: string;
  showCollapseControl: boolean;
  onNavigate?: () => void;
}

/**
 * O rodapé FIXO da barra — fora da área que rola.
 *
 * Medido em tela (1280×768, o notebook comum): com todos os grupos na área
 * rolável, o conteúdo dava 1019px contra 663px visíveis, e Configurações ficava
 * fora da dobra em TODAS as alturas testadas, inclusive 1080px. É o item que
 * mais se procura quando não se acha algo; deixá-lo dependendo de scroll
 * recriaria, em outra forma, o problema que a reorganização veio resolver.
 *
 * ── A ORDEM, E POR QUE ELA MUDOU ─────────────────────────────────────────────
 *
 * Era: conta, sino, Configurações, versão, "Recolher". Cinco blocos de pesos
 * diferentes empilhados sem hierarquia — e o sino era um quadrado de 40px sem
 * rótulo no meio de linhas de largura cheia, com um número vermelho flutuando.
 *
 * Hoje são TRÊS camadas, de cima para baixo, separadas por um fio só:
 *
 *  1. DESTINOS — "Avisos" (quando esta tela não tem cabeçalho) e
 *     "Configurações". São links, têm a forma de link, e estão na ordem em que
 *     se procura por eles;
 *  2. A CONTA — quem está logado e a única saída do produto. Fica sozinha entre
 *     dois fios porque não é destino: é identidade;
 *  3. A FAIXA BAIXA — versão e o botão de recolher, as duas coisas mais raras
 *     da barra, numa linha de 28px. O botão perdeu o rótulo "Recolher" e virou
 *     ícone: ele ocupava uma linha inteira de 40px para uma ação que se usa uma
 *     vez por semana, logo abaixo da que se usa todo dia.
 *
 * ⚠️ O FIO SAIU DO TOPO DO BLOCO. Ele era um `border-t` na moldura inteira, e
 * encostava na área que rola — ou seja, desenhava uma segunda linha horizontal
 * na mesma coluna que já tinha a de baixo da logo. Hoje ele separa a conta dos
 * destinos, que é a única fronteira de natureza que existe aqui.
 *
 * ⚠️ O botão de recolher continua chamando a MESMA Server Action de antes
 * (`toggleSidebar`, cookie httpOnly + `revalidatePath`). Ele não foi para o
 * cookie de cliente dos grupos porque a largura da barra é lida pelo SSR do
 * layout para decidir o que cabe na primeira pintura, e porque o comportamento
 * já estava provado. O que é novo aqui é só a forma.
 */
export function SidebarFooter({
  collapsed,
  compacto,
  pathname,
  showCollapseControl,
  onNavigate,
  mostrarAvisos = false,
}: SidebarFooterProps) {
  const t = useT();
  const [isPending, startTransition] = useTransition();
  const rodape = NAV_GROUPS.find((g) => g.id === GRUPO_NO_RODAPE)?.hub;

  const rotuloDoBotao = collapsed ? t("Expandir sidebar") : t("Recolher sidebar");
  const botao = (
    <button
      type="button"
      onClick={() => startTransition(() => toggleSidebar(collapsed))}
      disabled={isPending}
      /*
        ⚠️ SEM RÓTULO VISÍVEL, e o nome acessível NÃO mudou. Era um `nav-item`
        de largura cheia com a palavra "Recolher" — 40px de coluna para a ação
        mais rara da barra, do mesmo tamanho de "Inbox". Aqui ele é um alvo de
        28px na faixa baixa, e quem usa leitor de tela continua ouvindo a mesma
        frase que ouvia, porque ela sempre veio do `aria-label` e nunca do
        `<span>`.
      */
      className="nav-recolher"
      aria-label={rotuloDoBotao}
      data-nav-focavel=""
    >
      {collapsed ? (
        <CaretDoubleRight size={16} aria-hidden />
      ) : (
        <CaretDoubleLeft size={16} aria-hidden />
      )}
    </button>
  );

  return (
    <div className="shrink-0 space-y-0.5 p-2">
      {/*
        O SINO só quando esta tela não tem cabeçalho (hoje: o Inbox). Nas demais
        ele mora na barra superior, e desenhá-lo aqui também daria dois sinos com
        o mesmo contador.

        O `data-testid` fica no wrapper e não no sino: é ele que responde "o
        rodapé adotou o aviso?", que é a pergunta que
        `tests/unit/casca-esconde-o-cabecalho.test.tsx` faz nos dois sentidos.
      */}
      {mostrarAvisos && (
        <div data-testid="avisos-na-barra">
          <AlertsBell variante="linha" compacto={compacto} />
        </div>
      )}
      {rodape && (
        <SidebarItem
          href={rodape.href}
          label={t(rodape.label)}
          icon={Gear}
          ativo={pathname.startsWith(rodape.href)}
          compacto={compacto}
          onNavigate={onNavigate}
        />
      )}
      {/*
        A CONTA, em TODA rota, entre o fio e a faixa baixa.
        Ela é o único caminho de saída da conta no produto (ver o cabeçalho de
        `ContaNaBarra`), e pôr a saída embaixo do botão de recolher a esconderia
        atrás da coisa mais rara da tela.
      */}
      <div className="mt-1 border-t pt-1" data-testid="acoes-de-conta-na-barra">
        <ContaNaBarra compacto={compacto} />
      </div>
      <div
        className={cn(
          "flex items-center gap-1 pt-0.5",
          // Estreita, a versão sai (não cabe em 72px) e sobra o botão, centrado.
          compacto ? "justify-center" : "justify-between",
        )}
      >
        <VersionFooter compacto={compacto} onNavigate={onNavigate} />
        {showCollapseControl &&
          (compacto ? (
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>{botao}</TooltipTrigger>
              <TooltipContent side="right" className="nav-popover">
                {rotuloDoBotao}
              </TooltipContent>
            </Tooltip>
          ) : (
            botao
          ))}
      </div>
    </div>
  );
}
