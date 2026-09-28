"use client";
import { useState } from "react";
import { usePathname } from "next/navigation";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";

import { MarcaDaBarra } from "@/components/shell/sidebar/SidebarBrand";
import { SidebarItem } from "@/components/shell/sidebar/SidebarItem";
import { SidebarSection } from "@/components/shell/sidebar/SidebarSection";
import { useT } from "@/hooks/i18n/useT";
import { useMarcaDaInstalacao } from "@/lib/branding/contexto";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Buildings,
  CalendarBlank,
  ChartBar,
  ChartLineUp,
  ChatsCircle,
  ClipboardText,
  Gauge,
  Gear,
  Palette,
  Scales,
  ShieldCheck,
  Users,
  UsersThree,
  Warning,
} from "@/lib/ui/icons";

interface NavItem {
  href: string;
  label: string;
  icon: PhosphorIcon;
}

interface NavGrupo {
  id: string;
  label: string;
  icon: PhosphorIcon;
  itens: NavItem[];
}

/**
 * A navegação do painel da plataforma, agrupada por objetivo — o mesmo
 * desenho da barra do app (`components/shell/sidebar/AppSidebar.tsx`), com as
 * mesmas peças (`SidebarSection`, `SidebarItem`) e as mesmas classes da
 * moldura escura. Quem alterna entre `/app` e `/admin` reconhece o lugar.
 *
 * Ela NÃO entra em `lib/navigation/registry.ts`: aquele registro descreve a
 * navegação do tenant (`app/app/**`) e o teste de completude que o vigia varre
 * só aquela raiz. O admin de plataforma tem navegação própria, e é esta lista.
 */
const GRUPOS: NavGrupo[] = [
  {
    id: "visao",
    label: "Visão geral",
    icon: Gauge,
    itens: [
      { href: "/admin/dashboard", label: "Dashboard", icon: Gauge },
      { href: "/admin/users/relatorios", label: "Relatórios", icon: ChartLineUp },
      { href: "/admin/usage", label: "Uso", icon: ChartBar },
    ],
  },
  {
    id: "pessoas",
    label: "Pessoas",
    icon: UsersThree,
    itens: [
      { href: "/admin/users", label: "Usuários", icon: Users },
      { href: "/admin/platform-admins", label: "Admins da plataforma", icon: ShieldCheck },
    ],
  },
  {
    id: "organizacoes",
    label: "Organizações",
    icon: Buildings,
    itens: [
      { href: "/admin/tenants", label: "Organizações", icon: Buildings },
      { href: "/admin/inbox", label: "Inbox", icon: ChatsCircle },
    ],
  },
  {
    id: "conformidade",
    label: "Conformidade",
    icon: Scales,
    itens: [
      { href: "/admin/audit", label: "Auditoria", icon: ClipboardText },
      { href: "/admin/lgpd", label: "LGPD", icon: Scales },
      { href: "/admin/incidents", label: "Incidentes", icon: Warning },
    ],
  },
  {
    id: "instalacao",
    label: "Instalação",
    icon: Gear,
    itens: [
      // Configuração da INSTALAÇÃO, não de um tenant — por isso aqui e não em
      // Configurações do app.
      { href: "/admin/marca", label: "Marca", icon: Palette },
      { href: "/admin/google", label: "Google Agenda", icon: CalendarBlank },
    ],
  },
];

/** Todas as rotas do menu — exportado para o teste de que nenhuma tela ficou sem porta. */
export const ROTAS_DO_MENU_ADMIN = GRUPOS.flatMap((g) => g.itens.map((i) => i.href));

/**
 * Item ativo = o de prefixo MAIS LONGO que casa. `/admin/users/relatorios`
 * também começa com `/admin/users`, e sem esta regra os dois acenderiam juntos.
 */
function hrefAtivo(pathname: string): string | null {
  let melhor: string | null = null;
  for (const href of ROTAS_DO_MENU_ADMIN) {
    if (pathname === href || pathname.startsWith(href + "/")) {
      if (!melhor || href.length > melhor.length) melhor = href;
    }
  }
  return melhor;
}

interface AdminSidebarProps {
  userEmail: string;
  /** "mobile" = conteúdo desta MESMA navegação dentro do drawer que `AdminShell`
   * abre abaixo de `lg` — mesmo padrão de `components/shell/MobileSidebar.tsx`. */
  variant?: "desktop" | "mobile";
  onNavigate?: () => void;
}

export function AdminSidebar({ userEmail, variant = "desktop", onNavigate }: AdminSidebarProps) {
  const t = useT();
  const isMobile = variant === "mobile";
  const pathname = usePathname() ?? "";
  // Por PROP do servidor (contexto), e nunca `branding()`: aquela função lê
  // fontes diferentes nos dois lados da fronteira e daria hydration mismatch.
  // Ver `lib/branding/contexto.tsx`.
  const marca = useMarcaDaInstalacao();
  const [fechados, setFechados] = useState<Set<string>>(() => new Set());
  const ativo = hrefAtivo(pathname);

  const conteudo = (
    <>
      <MarcaDaBarra nome={marca.name} logoConfigurado={marca.logoUrl} collapsed={false} />
      <div className="px-4 pb-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border-strong)] px-2 py-0.5 text-[11px] font-medium text-text-muted">
          <ShieldCheck size={12} weight="duotone" aria-hidden />
          {t("Admin da plataforma")}
        </span>
      </div>
      <nav
        className="nav-rolagem flex-1 space-y-0.5 overflow-y-auto p-2"
        aria-label={t("Navegação plataforma")}
      >
        {GRUPOS.map((g) => (
          <SidebarSection
            key={g.id}
            id={`admin-${g.id}`}
            label={t(g.label)}
            icon={g.icon}
            aberto={!fechados.has(g.id)}
            compacto={false}
            onToggle={() =>
              setFechados((atual) => {
                const prox = new Set(atual);
                if (prox.has(g.id)) prox.delete(g.id);
                else prox.add(g.id);
                return prox;
              })
            }
          >
            <ul className="space-y-0.5">
              {g.itens.map((item) => (
                <li key={item.href}>
                  <SidebarItem
                    href={item.href}
                    label={t(item.label)}
                    icon={item.icon}
                    ativo={ativo === item.href}
                    compacto={false}
                    onNavigate={onNavigate}
                  />
                </li>
              ))}
            </ul>
          </SidebarSection>
        ))}
      </nav>
      <div className="shrink-0 space-y-1 border-t p-2">
        <SidebarItem
          href="/app"
          label={t("Voltar ao app")}
          icon={ArrowLeft}
          ativo={false}
          compacto={false}
          onNavigate={onNavigate}
        />
        <p className="truncate px-2.5 pb-1 text-[11px] text-text-subtle" title={userEmail}>
          {userEmail}
        </p>
      </div>
    </>
  );

  if (isMobile) {
    return <div className="flex h-full w-full flex-col">{conteudo}</div>;
  }

  return (
    <aside
      data-collapsed="false"
      className={cn("app-sidebar casca-escura sticky top-0 hidden h-dvh shrink-0 flex-col lg:flex")}
    >
      {conteudo}
    </aside>
  );
}
