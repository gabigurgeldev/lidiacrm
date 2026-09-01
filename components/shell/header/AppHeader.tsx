"use client";
import { Breadcrumb } from "@/components/shell/header/Breadcrumb";
import { GlobalSearch } from "@/components/shell/header/GlobalSearch";
import { HeaderActions } from "@/components/shell/header/HeaderActions";
import { MobileSidebar } from "@/components/shell/MobileSidebar";
import { TenantSwitcher } from "@/components/shell/TenantSwitcher";
import type { NavGroupId } from "@/lib/navigation/registry";

/**
 * A barra superior — três zonas, no modelo das toolbars do macOS.
 *
 *   [☰ celular] [onde estou] [organização?]   ·   [busca]   ·   [ações + perfil]
 *
 * ⚠️ A ALTURA É `h-14` (56px) E É CONTRATO, não estética. Duas telas calculam a
 * própria altura subtraindo este valor: `components/inbox/InboxLayout.tsx:259` e
 * `app/app/flows/[id]/_components/FlowBuilder.tsx:36`, as duas com o número
 * escrito à mão e um comentário apontando para cá. Mudar 56 para 64 daria à
 * lista de conversas e ao quadro de fluxos 8px a mais do que a tela tem — e o
 * sintoma seria uma barra de rolagem a mais, não um erro.
 *
 * A zona do meio tem largura FIXA em vez de `flex-1` centralizado: com `flex-1`,
 * o campo de busca mudava de posição conforme o comprimento do breadcrumb, e a
 * mesma tecla ⌘K abria um campo que estava num lugar diferente a cada rota.
 */
export function AppHeader({
  gruposAbertosSalvos = null,
}: {
  gruposAbertosSalvos?: NavGroupId[] | null;
}) {
  return (
    <header className="app-header sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 px-3 md:gap-4 md:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <MobileSidebar gruposAbertosSalvos={gruposAbertosSalvos} />
        <Breadcrumb />
        <TenantSwitcher />
      </div>
      <div className="w-9 shrink-0 md:w-[min(28rem,32vw)]">
        <GlobalSearch />
      </div>
      <div className="flex flex-1 justify-end">
        <HeaderActions />
      </div>
    </header>
  );
}
