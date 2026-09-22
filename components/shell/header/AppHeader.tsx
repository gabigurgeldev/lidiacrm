"use client";
import { GlobalSearch } from "@/components/shell/header/GlobalSearch";
import { HeaderActions } from "@/components/shell/header/HeaderActions";
import { MobileSidebar } from "@/components/shell/MobileSidebar";
import { TenantSwitcher } from "@/components/shell/TenantSwitcher";
import type { NavGroupId } from "@/lib/navigation/registry";

/**
 * A barra superior — três zonas, no modelo das toolbars do macOS.
 *
 *   [☰ celular] [organização?]   ·   [busca]   ·   [avisos]
 *
 * ⚠️ A ALTURA É `h-14` (56px) E É CONTRATO, não estética. Duas telas calculam a
 * própria altura subtraindo este valor: `components/inbox/InboxLayout.tsx:259` e
 * `app/app/flows/[id]/_components/FlowBuilder.tsx:36`, as duas com o número
 * escrito à mão e um comentário apontando para cá. Mudar 56 para 64 daria à
 * lista de conversas e ao quadro de fluxos 8px a mais do que a tela tem — e o
 * sintoma seria uma barra de rolagem a mais, não um erro.
 *
 * ── O cabeçalho tem UMA função: buscar ───────────────────────────────────────
 *
 * ⚠️ TRÊS COISAS SAÍRAM DAQUI, por decisão de quem é dono do produto, e nenhuma
 * delas foi apagada do produto:
 *
 *  - o BREADCRUMB ("Atendimento › Radar"): a barra lateral já acende o item da
 *    rota e o `<h1>` de cada tela já a nomeia — o caminho era a terceira cópia
 *    da mesma informação, e a única que ocupava a linha inteira;
 *  - o SELETOR DE IDIOMA: virou campo em Configurações › Perfil, que já o tinha;
 *  - o MENU DO USUÁRIO: desceu para o rodapé da barra lateral, junto de
 *    Configurações — ver `components/shell/sidebar/ContaNaBarra.tsx`. É por onde
 *    se SAI da conta, então ele não podia simplesmente sumir.
 *
 * A zona do meio tem largura FIXA em vez de `flex-1` centralizado: com `flex-1`
 * o campo de busca mudava de posição conforme o que houvesse à esquerda, e a
 * mesma tecla ⌘K abria um campo que estava num lugar diferente a cada rota.
 */
export function AppHeader({
  gruposAbertosSalvos = null,
}: {
  gruposAbertosSalvos?: NavGroupId[] | null;
}) {
  return (
    /*
      `casca-escura` é o escopo de token da moldura preta — a mesma classe da
      barra lateral, e é o que faz as duas serem uma peça só em vez de duas
      peças da mesma cor. Ver o bloco no `globals.css`.
    */
    <header className="app-header casca-escura sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 px-3 md:gap-4 md:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <MobileSidebar gruposAbertosSalvos={gruposAbertosSalvos} />
        {/* Os dois devolvem `null` no caso comum — o ☰ some a partir de `md`, e o
            seletor de empresa só existe para quem tem mais de uma. Numa
            instalação de um cliente só, em laptop, esta zona fica vazia de
            propósito: é o que centra a busca na tela. */}
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
