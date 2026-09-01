"use client";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useT } from "@/hooks/i18n/useT";
import { SidebarContent } from "@/components/shell/Sidebar";
import { List } from "@/lib/ui/icons";
import type { NavGroupId } from "@/lib/navigation/registry";

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
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 md:hidden"
          aria-label={t("Abrir navegação")}
        >
          <List size={20} aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="left"
        // As duas classes que fazem a gaveta DESLIZAR e o véu escurecer com
        // desfoque — ver o bloco `.nav-drawer` em `app/globals.css`. Sem elas o
        // painel simplesmente aparece, que é como todos os Sheets deste produto
        // se comportam desde que `tailwindcss-animate` não foi instalado.
        className="nav-drawer flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-0 border-r p-0 sm:max-w-xs"
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
