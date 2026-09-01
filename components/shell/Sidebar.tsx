"use client";
import { AppSidebar, SidebarContent } from "@/components/shell/sidebar/AppSidebar";
import type { NavGroupId } from "@/lib/navigation/registry";

/**
 * Ponte para a barra lateral, que virou uma pasta.
 *
 * O componente inteiro morava aqui — marca, grupos, itens, rodapé e o botão de
 * recolher, tudo num arquivo. Ele foi quebrado em `components/shell/sidebar/`
 * quando os grupos passaram a recolher: cada peça daquelas ganhou estado,
 * medição de altura ou tooltip próprio, e um arquivo só voltaria a ser o
 * componente-gigante que a doutrina de componentização proíbe.
 *
 * Este módulo continua existindo, e não é resíduo: `MobileSidebar` e quatro
 * arquivos de teste importam `@/components/shell/Sidebar` por nome. Mantê-lo
 * como fachada deixou a mudança inteira ser de forma — nenhum consumidor
 * precisou aprender um caminho novo.
 */
export { SidebarContent };

export function Sidebar({
  collapsed,
  gruposAbertosSalvos = null,
}: {
  collapsed: boolean;
  gruposAbertosSalvos?: NavGroupId[] | null;
}) {
  return <AppSidebar collapsed={collapsed} gruposAbertosSalvos={gruposAbertosSalvos} />;
}
