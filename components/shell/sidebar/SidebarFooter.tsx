"use client";
import { useTransition } from "react";

import { toggleSidebar } from "@/app/actions/shell/toggleSidebar";
import { VersionFooter } from "@/components/shell/VersionFooter";
import { SidebarItem } from "@/components/shell/sidebar/SidebarItem";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HeaderActions } from "@/components/shell/header/HeaderActions";
import { useT } from "@/hooks/i18n/useT";
import { cn } from "@/lib/utils";
import { CaretDoubleLeft, CaretDoubleRight, Gear } from "@/lib/ui/icons";
import { GRUPO_NO_RODAPE, NAV_GROUPS } from "@/lib/navigation/registry";

interface SidebarFooterProps {
  collapsed: boolean;
  /**
   * O cabeçalho do app sumiu desta tela, e as ações de conta ficaram órfãs.
   *
   * Sino, idioma, tema e avatar moram na barra superior. No Inbox ela não é
   * desenhada (ver `lib/navigation/casca.ts`), e sem esta prop os quatro
   * simplesmente deixariam de existir na tela em que a pessoa passa o dia — o
   * aviso de mensagem nova inclusive.
   *
   * ⚠️ UM LUGAR DE CADA VEZ, nunca os dois: quem decide é a MESMA função que a
   * casca consulta para não desenhar o cabeçalho. Duas regras separadas não
   * dariam erro — dariam o avatar duas vezes, ou nenhuma, em silêncio.
   */
  mostrarAcoesDeConta?: boolean;
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
  mostrarAcoesDeConta = false,
}: SidebarFooterProps) {
  const t = useT();
  const [isPending, startTransition] = useTransition();
  const rodape = NAV_GROUPS.find((g) => g.id === GRUPO_NO_RODAPE)?.hub;

  const botao = (
    <button
      type="button"
      onClick={() => startTransition(() => toggleSidebar(collapsed))}
      disabled={isPending}
      className="nav-item text-[13px]"
      aria-label={collapsed ? t("Expandir sidebar") : t("Recolher sidebar")}
      data-nav-focavel=""
    >
      {collapsed ? (
        <CaretDoubleRight size={16} className="nav-icone shrink-0" aria-hidden />
      ) : (
        <CaretDoubleLeft size={16} className="nav-icone shrink-0" aria-hidden />
      )}
      <span className="nav-rotulo truncate">{t("Recolher")}</span>
    </button>
  );

  return (
    <div className="shrink-0 space-y-0.5 border-t p-2">
      {/*
        ACIMA de Configurações, e não abaixo: o rodapé se lê de baixo para cima
        em ordem de raridade — recolher a barra é o que menos se toca, e o sino é
        o que mais. Estreita, `HeaderActions` já empilha sozinho (os botões são
        `shrink-0` num flex), então não há caso especial de largura aqui.
      */}
      {mostrarAcoesDeConta && (
        <div
          className={cn("mb-1 flex items-center gap-0.5 pb-1", compacto && "flex-col")}
          data-testid="acoes-de-conta-na-barra"
        >
          <HeaderActions />
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
      <VersionFooter collapsed={collapsed} onNavigate={onNavigate} />
      {showCollapseControl &&
        (compacto ? (
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>{botao}</TooltipTrigger>
            <TooltipContent side="right" className="nav-popover">
              {t("Expandir sidebar")}
            </TooltipContent>
          </Tooltip>
        ) : (
          botao
        ))}
    </div>
  );
}
