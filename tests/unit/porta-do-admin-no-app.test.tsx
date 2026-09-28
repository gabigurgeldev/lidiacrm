import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { SidebarFooter } from "@/components/shell/sidebar/SidebarFooter";
import { TooltipProvider } from "@/components/ui/tooltip";
import { mostraPortaDoAdmin, PORTA_DO_ADMIN } from "@/lib/navigation/porta-do-admin";

/**
 * A porta do app para o painel da plataforma (`/admin`).
 *
 * Antes dela, o painel só era alcançável digitando a URL. A regra é UMA:
 * `is_platform_admin`. Papel de organização — inclusive `admin` — não abre a
 * porta, porque o painel enxerga todas as organizações da instalação.
 */

let usuario = { is_platform_admin: false };

vi.mock("@/hooks/auth/AuthProvider", () => ({
  useUser: () => ({
    id: "u1",
    email: "pessoa@exemplo.com",
    full_name: null,
    avatar_url: null,
    ...usuario,
  }),
  useAuth: () => ({
    user: { id: "u1", email: "pessoa@exemplo.com", full_name: null, avatar_url: null, ...usuario },
    activeOrg: { orgId: "o1", name: "Org", role: "admin" },
    signOut: vi.fn(),
  }),
}));
vi.mock("@/app/actions/shell/toggleSidebar", () => ({ toggleSidebar: vi.fn() }));
vi.mock("@/components/shell/VersionFooter", () => ({ VersionFooter: () => null }));
vi.mock("@/components/shell/AlertsBell", () => ({ AlertsBell: () => null }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (chave: string) => chave }));

afterEach(cleanup);

function montar() {
  return render(
    <TooltipProvider>
      <SidebarFooter collapsed={false} compacto={false} pathname="/app/inbox" showCollapseControl={false} />
    </TooltipProvider>,
  );
}

describe("porta do admin no app", () => {
  it("platform admin vê o link para /admin no rodapé da barra", () => {
    usuario = { is_platform_admin: true };
    montar();
    const link = screen.getByRole("link", { name: PORTA_DO_ADMIN.label });
    expect(link).toHaveAttribute("href", "/admin/dashboard");
  });

  it("admin de ORGANIZAÇÃO que não é platform admin NÃO vê a porta", () => {
    usuario = { is_platform_admin: false };
    montar();
    expect(screen.queryByRole("link", { name: PORTA_DO_ADMIN.label })).toBeNull();
    expect(screen.queryByTestId("porta-do-admin")).toBeNull();
  });

  it("a regra só abre com true explícito", () => {
    expect(mostraPortaDoAdmin({ is_platform_admin: true })).toBe(true);
    expect(mostraPortaDoAdmin({ is_platform_admin: false })).toBe(false);
    expect(mostraPortaDoAdmin({ is_platform_admin: null })).toBe(false);
    expect(mostraPortaDoAdmin(null)).toBe(false);
  });
});
