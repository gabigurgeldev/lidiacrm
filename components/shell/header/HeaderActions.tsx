"use client";
import { AlertsBell } from "@/components/shell/AlertsBell";

/**
 * O lado direito do cabeçalho.
 *
 * ⚠️ ERAM TRÊS PEÇAS (idioma, sino, avatar) E HOJE É UMA, e a redução é decisão
 * de quem é dono do produto, não faxina:
 *
 *  - o SELETOR DE IDIOMA saiu do produto como peça de casca. O campo em
 *    Configurações › Perfil já existia e passou a ser o único lugar — junto com
 *    o recarregamento que só o seletor fazia, e que agora vive lá
 *    (`app/app/settings/profile/_form.tsx`);
 *  - o MENU DO USUÁRIO desceu para o rodapé da barra lateral
 *    (`components/shell/sidebar/ContaNaBarra.tsx`). Ele é o ÚNICO caminho de
 *    saída da conta no produto inteiro, então mover não podia virar apagar.
 *
 * O que sobra é o sino, e o wrapper continua existindo por dois motivos: ele
 * segura o contrato de layout da zona (não encolhe, alinhado à direita) e é a
 * costura onde a próxima ação de cabeçalho entra sem mexer no `AppHeader`.
 *
 * ⚠️ O alternador de tema saiu antes e não foi para outro lugar: o produto tem
 * UM tema. Ver `app/layout.tsx`.
 */
export function HeaderActions() {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <AlertsBell />
    </div>
  );
}
