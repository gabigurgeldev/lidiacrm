"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { MobileSidebar } from "@/components/shell/MobileSidebar";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useT } from "@/hooks/i18n/useT";
import {
  abaAtiva,
  abasDaBarraInferior,
  barraInferiorVisivel,
  CLASSE_ABA,
  CLASSE_ICONE_DA_ABA,
  CLASSE_ROTULO_DA_ABA,
} from "@/lib/navigation/barra-inferior";
import type { NavGroupId } from "@/lib/navigation/registry";

/** Campo em que se digita — com o teclado do celular aberto, a barra sai do caminho. */
function ehCampoDeTexto(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    return !["checkbox", "radio", "button", "submit", "reset", "file", "range", "color"].includes(
      el.type,
    );
  }
  return (el as HTMLElement).isContentEditable === true;
}

/**
 * A barra de abas do celular — Conversas, Kanban, Contatos, Agenda e Mais.
 *
 * A regra (quais abas, quando some) é pura e mora em
 * `lib/navigation/barra-inferior.ts`; aqui só o desenho. `md:hidden`: no
 * desktop a barra lateral faz este papel. O corte por largura é do CSS, para a
 * primeira pintura já sair certa (media query em JS pisca depois da hidratação).
 */
export function BarraInferior({
  gruposAbertosSalvos = null,
}: {
  gruposAbertosSalvos?: NavGroupId[] | null;
}) {
  const t = useT();
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const { user, activeOrg } = useAuth();
  const [digitando, setDigitando] = useState(false);

  // O teclado do celular encolhe a tela; uma barra de 56px a mais em cima dele
  // tiraria justo o espaço de ver o que se escreve.
  useEffect(() => {
    const atualizar = () => setDigitando(ehCampoDeTexto(document.activeElement));
    document.addEventListener("focusin", atualizar);
    document.addEventListener("focusout", atualizar);
    return () => {
      document.removeEventListener("focusin", atualizar);
      document.removeEventListener("focusout", atualizar);
    };
  }, []);

  if (!barraInferiorVisivel(pathname, searchParams?.get("id") ?? null)) return null;

  const abas = abasDaBarraInferior(user.is_platform_admin, activeOrg?.role ?? null);

  return (
    <nav
      aria-label={t("Navegação rápida")}
      data-testid="barra-inferior"
      className={
        digitando
          ? "hidden"
          : "flex shrink-0 items-stretch border-t border-border bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
      }
    >
      {abas.map(({ href, rotulo, icon: Icone }) => {
        const ativa = abaAtiva(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            className={CLASSE_ABA}
            data-ativa={ativa ? "true" : undefined}
            aria-current={ativa ? "page" : undefined}
          >
            <span className={CLASSE_ICONE_DA_ABA}>
              <Icone size={22} weight={ativa ? "fill" : "regular"} aria-hidden />
            </span>
            <span className={CLASSE_ROTULO_DA_ABA}>{t(rotulo)}</span>
          </Link>
        );
      })}
      <MobileSidebar gruposAbertosSalvos={gruposAbertosSalvos} />
    </nav>
  );
}
