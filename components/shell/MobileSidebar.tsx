"use client";
import { useState } from "react";

import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useT } from "@/hooks/i18n/useT";
import { SidebarContent } from "@/components/shell/Sidebar";
import { List } from "@/lib/ui/icons";
import type { NavGroupId } from "@/lib/navigation/registry";
import {
  CLASSE_ABA,
  CLASSE_ICONE_DA_ABA,
  CLASSE_ROTULO_DA_ABA,
} from "@/lib/navigation/barra-inferior";

/**
 * Navegação mobile do app autenticado.
 *
 * O estado "Recolher" é do sidebar desktop e persiste em cookie. No mobile a
 * navegação é uma gaveta temporária: abrir/fechar não escreve esse cookie, para
 * não trocar a preferência que a pessoa escolheu no laptop.
 *
 * ⚠️ `variante="gaveta"` desliga a compactação por largura de tela. A barra do
 * desktop compacta sozinha abaixo de 1024px (é o tablet), e a gaveta é montada
 * justamente onde essa consulta sempre casa — sem esta prop, ela abriria com
 * 264px de largura mostrando só ícones.
 *
 * Os grupos abertos, esses SIM são os mesmos: é a mesma pessoa, o mesmo cookie,
 * e o arranjo que ela deixou no celular é o que ela espera encontrar de volta.
 */
/*
 * A PORTA da gaveta é o "Mais" da barra de abas do celular
 * (`components/shell/BarraInferior.tsx`). Até 04/11/2026 era um ☰ no cabeçalho;
 * ele saiu porque no Inbox o cabeçalho some, e a navegação sumia junto. O nome
 * acessível contém "abrir navegação" — é por ele que `navegacao.spec.ts` (390px)
 * encontra a gaveta.
 */
export function MobileSidebar({
  gruposAbertosSalvos = null,
}: {
  gruposAbertosSalvos?: NavGroupId[] | null;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className={CLASSE_ABA}
          data-ativa={open ? "true" : undefined}
          aria-label={t("Mais: abrir navegação")}
          data-testid="barra-inferior-mais"
        >
          <span className={CLASSE_ICONE_DA_ABA}>
            <List size={22} aria-hidden />
          </span>
          <span className={CLASSE_ROTULO_DA_ABA}>{t("Mais")}</span>
        </button>
      </SheetTrigger>
      <SheetContent
        side="left"
        // As duas classes que fazem a gaveta DESLIZAR e o véu escurecer com
        // desfoque — ver o bloco `.nav-drawer` em `app/globals.css`. Sem elas o
        // painel simplesmente aparece, que é como todos os Sheets deste produto
        // se comportam desde que `tailwindcss-animate` não foi instalado.
        // `casca-escura` pelo mesmo motivo da barra do desktop: a gaveta É a
        // navegação, e sem o escopo ela abriria branca sobre um produto cuja
        // navegação é preta — a mesma lista com duas caras conforme a largura
        // da tela. `bg-card` resolve dentro do escopo, então basta a classe.
        className="nav-drawer casca-escura flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-0 border-r p-0 sm:max-w-xs"
        overlayClassName="nav-drawer-overlay"
      >
        <SheetTitle className="sr-only">{t("Navegação principal")}</SheetTitle>
        <SidebarContent
          collapsed={false}
          variante="gaveta"
          gruposAbertosSalvos={gruposAbertosSalvos}
          showCollapseControl={false}
          onNavigate={() => setOpen(false)}
        />
      </SheetContent>
    </Sheet>
  );
}
