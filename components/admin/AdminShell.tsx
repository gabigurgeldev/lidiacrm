"use client";
import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { PlatformModeBanner } from "./PlatformModeBanner";
import { AdminSidebar } from "./AdminSidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowLeft, List } from "@/lib/ui/icons";
import { useT } from "@/hooks/i18n/useT";

interface AdminShellProps {
  userEmail: string;
  children: ReactNode;
}

/**
 * Shell for /admin/*. Renders the cross-tenant banner (sticky top), platform
 * sidebar, and main content area. Client component (não mais Server) desde
 * que ganhou o drawer de navegação mobile — precisa do estado de
 * aberto/fechado, no mesmo padrão de `app/app/_components/AppShell.tsx`;
 * `children` continua chegando como Server Component normalmente (React
 * permite RSC como `children` de um Client Component sem forçar o subtree
 * inteiro pro cliente).
 *
 * O `TooltipProvider` mora aqui, e não em cada componente, porque o Radix exige
 * um Provider ANCESTRAL de todo `Tooltip`: sem ele o componente lança
 * "`Tooltip` must be used within `TooltipProvider`" no cliente, e o React
 * derruba a árvore inteira — a tela vira a página de erro do Next, não um
 * tooltip quebrado. O dono não recebe pista nenhuma: vê "Algo deu errado" e um
 * ID opaco (`app/error.tsx`), e no servidor não há rastro, porque o erro é do
 * cliente.
 *
 * QUEM É ATINGIDO, medido em vez de suposto: o único consumidor do Tooltip do
 * Radix sem Provider próprio é o `TenantBadge`. Ele é montado em 4 telas —
 * /admin/inbox, /admin/inbox/[conversationId], /admin/lgpd e
 * /admin/lgpd/requests/[id]. Os outros três importadores de
 * `components/ui/tooltip` (CredentialCard, MessageBubble, PlatformAdminsTable)
 * embrulham o seu, por isso nunca quebraram.
 *
 * O que este Provider NÃO conserta, apesar de parecer: /admin/usage e
 * /app/ai/usage. Os gráficos de lá (`UsageCharts`, `UsageChart`) importam um
 * `Tooltip` de nome igual e origem diferente — o do **recharts**, que não usa
 * Provider nenhum. Verificado abrindo /admin/usage com o defeito presente: a
 * tela carrega normalmente. Fica escrito porque o nome colide e o próximo
 * leitor vai procurar um Provider faltando ali e não vai encontrar.
 *
 * A quebra é CONDICIONAL A DADO: os mounts de `TenantBadge` estão atrás de
 * guarda de organização resolvida, então uma instalação sem conversas (ou sem
 * solicitação LGPD) abre as 4 telas normalmente mesmo com o defeito. Quem for
 * reproduzir precisa de pelo menos uma linha com tenant; ver a tela abrir num
 * banco vazio não significa que o defeito não existe.
 *
 * Um Provider na casca cobre as quatro telas de uma vez e faz tela nova nascer
 * funcionando, em vez de repetir o erro a cada tela adicionada — é o padrão
 * recomendado pelo Radix (Provider perto da raiz, compartilhando o delay).
 */
export function AdminShell({ userEmail, children }: AdminShellProps) {
  const t = useT();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Mesmo padrão de `app/app/_components/AppShell.tsx`: ajuste de estado
  // durante o render, não em `useEffect` (ver comentário lá).
  const pathname = usePathname();
  const [ultimoPathname, setUltimoPathname] = useState(pathname);
  if (pathname !== ultimoPathname) {
    setUltimoPathname(pathname);
    setMobileNavOpen(false);
  }

  /*
    A MESMA MOLDURA DO APP (`app/app/_components/AppShell.tsx`): barra lateral
    e cabeçalho escuros formando um L (`casca-moldura` + `casca-escura`), e o
    conteúdo num painel claro encaixado, com o canto superior-esquerdo
    arredondado. Quem alterna entre `/app` e `/admin` reconhece o lugar em vez
    de cair num produto com cara de outro.

    `h-dvh` + `overflow-hidden` na casca e `min-h-0`/`min-w-0` na coluna: o
    `<main>` é "o que sobrou" e rola sozinho — ver o comentário de lá para a
    classe de defeito que isso evita.
  */
  return (
    <TooltipProvider>
      <div className="casca-moldura flex h-dvh w-full overflow-hidden">
        <AdminSidebar userEmail={userEmail} />
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetContent
            side="left"
            className="nav-drawer casca-escura flex w-72 max-w-[85vw] flex-col gap-0 border-r p-0 lg:hidden"
          >
            <SheetTitle className="sr-only">{t("Menu de navegação")}</SheetTitle>
            <AdminSidebar
              userEmail={userEmail}
              variant="mobile"
              onNavigate={() => setMobileNavOpen(false)}
            />
          </SheetContent>
        </Sheet>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="app-header casca-escura flex h-14 shrink-0 items-center gap-2 px-3 md:gap-4 md:px-6">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0 text-text lg:hidden"
              onClick={() => setMobileNavOpen(true)}
              aria-label={t("Abrir menu de navegação")}
            >
              <List size={20} aria-hidden />
            </Button>
            <span className="truncate text-sm font-semibold tracking-tight text-text lg:hidden">
              {t("Admin da plataforma")}
            </span>
            <PlatformModeBanner />
            <Link
              href="/app"
              className="ml-auto hidden shrink-0 items-center gap-1.5 rounded-[var(--nav-raio,10px)] px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-[var(--color-surface-elevated)] hover:text-text sm:inline-flex"
            >
              <ArrowLeft size={14} aria-hidden />
              {t("Voltar ao app")}
            </Link>
          </header>
          {/* `overflow-x-hidden` como rede de segurança — mesmo motivo do
              `AppShell`: se algo estourar a largura, a PÁGINA não rola de lado;
              quem precisa de scroll horizontal é o componente, contido nele. */}
          <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-surface lg:rounded-tl-[var(--casca-raio)]">
            <div className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
              {children}
            </div>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
