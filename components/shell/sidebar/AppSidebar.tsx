"use client";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, useSyncExternalStore, type KeyboardEvent } from "react";

import { ConnectionHealthDot } from "@/components/connections/ConnectionHealthDot";
import { SidebarBrand } from "@/components/shell/sidebar/SidebarBrand";
import { SidebarFooter } from "@/components/shell/sidebar/SidebarFooter";
import { SidebarItem } from "@/components/shell/sidebar/SidebarItem";
import { SidebarSection } from "@/components/shell/sidebar/SidebarSection";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useT } from "@/hooks/i18n/useT";
import { cn } from "@/lib/utils";
import { cabecalhoEscondidoEm } from "@/lib/navigation/casca";
import {
  gravarGruposAbertos,
  gruposIniciais,
  grupoDaRota,
} from "@/lib/navigation/grupos-abertos";
import {
  GRUPO_NO_RODAPE,
  ICONE_DO_HUB,
  sidebarGroups,
  type NavGroupId,
} from "@/lib/navigation/registry";

/**
 * A faixa em que a barra é estreita por LARGURA DE TELA (tablet), e não por
 * escolha de quem usa.
 *
 * Serve a UMA coisa só: decidir se um item monta tooltip. Não pode decidir
 * layout — a largura é do CSS justamente para o primeiro pixel do servidor já
 * estar certo, e uma medida de `matchMedia` só existe depois da hidratação.
 *
 * `useSyncExternalStore` com instantâneo de servidor `false` é o caminho que o
 * React sanciona para isto: a hidratação usa o valor do servidor e o ajuste vem
 * no render seguinte, sem aviso de divergência. Tooltip é comportamento de
 * ponteiro; um quadro de atraso é invisível.
 */
const CONSULTA_ESTREITA = "(max-width: 1023px)";

function assinarLargura(aoMudar: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia(CONSULTA_ESTREITA);
  mq.addEventListener("change", aoMudar);
  return () => mq.removeEventListener("change", aoMudar);
}

function useTelaEstreita(): boolean {
  return useSyncExternalStore(
    assinarLargura,
    () => (typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia(CONSULTA_ESTREITA).matches
      : false),
    () => false,
  );
}

interface SidebarContentProps {
  collapsed: boolean;
  /**
   * O que o cookie do navegador dizia quando o servidor montou a página.
   * `null` = nunca escolheu nada — ver `lib/navigation/grupos-abertos.ts`.
   */
  gruposAbertosSalvos?: NavGroupId[] | null;
  showCollapseControl?: boolean;
  onNavigate?: () => void;
  /**
   * `"gaveta"` desliga a compactação por largura de tela: a gaveta do celular é
   * larga por definição, e sem isto ela se compactaria justamente onde a
   * consulta `max-width: 1023px` sempre casa.
   */
  variante?: "barra" | "gaveta";
}

/**
 * Navegação principal, agrupada por objetivo e recolhível grupo a grupo.
 *
 * Não decide o que existe: `sidebarGroups()` (lib/navigation/registry.ts)
 * resolve quais grupos e destinos este papel vê, e este componente desenha.
 * Antes, a lista de itens e sete `usePermission()` viviam aqui — e divergiam do
 * hub de Configurações e das abas de IA, que mantinham suas próprias listas.
 */
export function SidebarContent({
  collapsed,
  gruposAbertosSalvos = null,
  showCollapseControl = true,
  onNavigate,
  variante = "barra",
}: SidebarContentProps) {
  // A barra lateral aparece em TODA tela — traduzi-la aqui é o que faz a
  // escolha de idioma virar algo visível no primeiro clique.
  const t = useT();
  const pathname = usePathname();
  const { user, activeOrg } = useAuth();
  const telaEstreita = useTelaEstreita();
  const compacto = variante === "barra" && (collapsed || telaEstreita);

  const todos = sidebarGroups(user.is_platform_admin, activeOrg?.role ?? null);
  // Configurações sai da área que rola e vai para o rodapé fixo.
  const grupos = todos.filter((g) => g.group.id !== GRUPO_NO_RODAPE);

  const [abertos, setAbertos] = useState<Set<NavGroupId>>(() =>
    gruposIniciais(gruposAbertosSalvos, pathname),
  );

  /**
   * Navegar para uma tela cujo grupo está fechado o ABRE.
   *
   * Sem isto, chegar em /app/webhooks pelo ⌘K com Canais fechado deixaria a
   * barra sem nenhuma marca de onde se está, e descobrir exigiria abrir grupo
   * por grupo. Só reage a MUDANÇA de rota: fechar o grupo da página em que se
   * está continua valendo enquanto se está nela.
   */
  useEffect(() => {
    const daRota = grupoDaRota(pathname);
    if (!daRota) return;
    setAbertos((atual) => (atual.has(daRota) ? atual : new Set(atual).add(daRota)));
  }, [pathname]);

  const alternar = useCallback((id: NavGroupId) => {
    setAbertos((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      gravarGruposAbertos(proximo);
      return proximo;
    });
  }, []);

  /**
   * Teclado na barra: ↑/↓ percorrem, →/← abrem e fecham o grupo, Home/End vão
   * às pontas. É WCAG 2.1.1 — a barra é a única porta para vinte telas, e sem
   * isto quem não usa mouse depende de Tab passando por cada link até chegar.
   *
   * A lista de focáveis é recalculada a cada tecla, e não memoizada: um grupo
   * que acabou de fechar tem `visibility: hidden`, e um item invisível na lista
   * mandaria o foco para o nada.
   */
  const aoTeclado = useCallback((evento: KeyboardEvent<HTMLElement>) => {
    const teclas = ["ArrowDown", "ArrowUp", "Home", "End", "ArrowRight", "ArrowLeft"];
    if (!teclas.includes(evento.key)) return;

    const alvo = evento.target as HTMLElement;
    if (!alvo.matches?.("[data-nav-focavel]")) return;

    if (evento.key === "ArrowRight" || evento.key === "ArrowLeft") {
      const id = alvo.getAttribute("data-nav-grupo");
      if (!id) return;
      const querAberto = evento.key === "ArrowRight";
      if (abertos.has(id as NavGroupId) !== querAberto) {
        evento.preventDefault();
        alternar(id as NavGroupId);
      }
      return;
    }

    // ⚠️ `visibility` ENTRA NO FILTRO, e `offsetParent` sozinho não bastava.
    //
    // Um grupo fechado esconde os itens com `visibility: hidden`, e isso NÃO os
    // tira do layout: `offsetParent` continua devolvendo um elemento, e o item
    // entrava na lista. Como elemento invisível não é focável, `.focus()` não
    // fazia nada — a seta para baixo simplesmente parava de funcionar ao chegar
    // no primeiro grupo fechado, sem erro nenhum.
    //
    // A regra sai do próprio CSS em vez de reimplementar "está aberto?" aqui: a
    // `visibility` é herdada, então perguntá-la ao ITEM já responde pelo pai.
    const focaveis = [
      ...evento.currentTarget.querySelectorAll<HTMLElement>("[data-nav-focavel]"),
    ].filter(
      (el) => el.offsetParent !== null && getComputedStyle(el).visibility !== "hidden",
    );
    if (focaveis.length === 0) return;

    const atual = focaveis.indexOf(alvo);
    let proximo = atual;
    if (evento.key === "ArrowDown") proximo = Math.min(atual + 1, focaveis.length - 1);
    if (evento.key === "ArrowUp") proximo = Math.max(atual - 1, 0);
    if (evento.key === "Home") proximo = 0;
    if (evento.key === "End") proximo = focaveis.length - 1;
    if (proximo === atual) return;

    evento.preventDefault();
    focaveis[proximo]?.focus();
  }, [abertos, alternar]);

  return (
    /*
      O provedor de tooltip mora AQUI, e não na casca, porque a barra é o único
      lugar que os usa e porque ela é montada em três contextos diferentes: o
      `<aside>` do desktop, a gaveta do celular e o `render()` dos testes. O
      Radix lança "`Tooltip` must be used within `TooltipProvider`" no cliente
      quando falta — um provedor na casca deixaria a barra impossível de montar
      sozinha, e o teste que a monta é justamente o que prova a permissão.
    */
    <TooltipProvider delayDuration={300}>
      <SidebarBrand collapsed={collapsed} />
      <nav
        className="nav-rolagem flex-1 space-y-1 overflow-y-auto p-2"
        aria-label={t("Navegação principal")}
        onKeyDown={aoTeclado}
      >
        {grupos.map(({ group, items }) => (
          <SidebarSection
            key={group.id}
            id={group.id}
            label={t(group.label)}
            icon={group.icon}
            aberto={abertos.has(group.id)}
            compacto={compacto}
            onToggle={() => alternar(group.id)}
          >
            <ul className="space-y-0.5">
              {items.map((item) => (
                <li key={item.href}>
                  <SidebarItem
                    href={item.href}
                    label={t(item.label)}
                    icon={item.icon}
                    ativo={pathname === item.href || pathname.startsWith(item.href + "/")}
                    compacto={compacto}
                    onNavigate={onNavigate}
                    extra={
                      item.healthDot ? (
                        <ConnectionHealthDot
                          className={cn(compacto ? "absolute right-1.5 top-1.5" : "ml-auto")}
                        />
                      ) : undefined
                    }
                  />
                </li>
              ))}
              {group.hub && (
                <li>
                  <SidebarItem
                    href={group.hub.href}
                    label={t(group.hub.label)}
                    icon={ICONE_DO_HUB}
                    ativo={pathname === group.hub.href}
                    compacto={compacto}
                    onNavigate={onNavigate}
                  />
                </li>
              )}
            </ul>
          </SidebarSection>
        ))}
      </nav>
      <SidebarFooter
        collapsed={collapsed}
        compacto={compacto}
        pathname={pathname}
        showCollapseControl={showCollapseControl}
        onNavigate={onNavigate}
        /*
          ⚠️ `variante === "barra"` NÃO É REDUNDANTE aqui.

          A gaveta do celular monta o mesmo rodapé, e no celular o cabeçalho
          CONTINUA na tela mesmo no Inbox — é lá que mora o ☰ que abre esta
          própria gaveta. Sem esta condição, quem abrisse a gaveta no celular
          veria sino, idioma, tema e avatar DUPLICADOS: uma vez no cabeçalho
          atrás dela, outra dentro dela.
        */
        mostrarAcoesDeConta={variante === "barra" && cabecalhoEscondidoEm(pathname)}
      />
    </TooltipProvider>
  );
}

export function AppSidebar({
  collapsed,
  gruposAbertosSalvos = null,
}: {
  collapsed: boolean;
  gruposAbertosSalvos?: NavGroupId[] | null;
}) {
  return (
    <aside
      data-collapsed={collapsed ? "true" : "false"}
      className={cn(
        // ⚠️ `sticky`, e NUNCA `fixed`.
        //
        // Com `fixed` a barra sai do fluxo: ela não ocupa lugar nenhum na linha,
        // e quem afastava o conteúdo era um `md:ml-16`/`md:ml-60` do lado de lá.
        // Duas medidas para a mesma coisa, em componentes diferentes — e no dia
        // em que discordassem (largura de 60 com margem de 16), a barra passava
        // POR CIMA da lista de conversas, escondendo o começo de cada linha.
        //
        // Foi assim que apareceu numa instalação real: a barra expandida, com as
        // etiquetas legíveis, e a lista atrás dela cortada. Um F5 "consertava",
        // que é a assinatura de servidor e navegador terem pintado estados
        // diferentes — e `AppShell` e `Sidebar` são ambos `"use client"`.
        //
        // `sticky top-0 h-screen` dá o mesmo efeito visual (a barra não rola com
        // a página) e ela VOLTA a ocupar lugar: sobra para o conteúdo exatamente
        // o que ela não usou, e não há segunda medida para discordar.
        //
        // `shrink-0` porque item de flex encolhe por padrão, e uma barra de 60
        // espremida para caber é o mesmo defeito por outro caminho.
        //
        // A LARGURA saiu daqui para `.app-sidebar` no globals.css: ela agora tem
        // duas origens (o cookie e o `@media` do tablet), e uma classe do
        // Tailwind só sabe da primeira.
        "app-sidebar sticky top-0 z-30 flex h-screen shrink-0 flex-col border-r bg-card",
      )}
    >
      <SidebarContent collapsed={collapsed} gruposAbertosSalvos={gruposAbertosSalvos} />
    </aside>
  );
}
