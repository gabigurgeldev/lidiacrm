"use client";
import { AlertsBell } from "@/components/shell/AlertsBell";
import { SeletorDeIdioma } from "@/components/shell/SeletorDeIdioma";
import { ProfileMenu } from "@/components/shell/header/ProfileMenu";

/**
 * O lado direito do cabeçalho, em UM grupo.
 *
 * Antes eram três blocos soltos: o sino tinha 44px de altura, o seletor de
 * idioma vinha de dentro do menu do usuário (que o desenhava fora dele, ao lado
 * do avatar) e o avatar tinha 40. Três alturas diferentes na mesma linha de
 * 56px é o que fazia a faixa parecer improvisada.
 *
 * Aqui todos ficam numa faixa só, com o mesmo gap. A ordem é por frequência de
 * uso, da menos para a mais: o idioma se toca uma vez na vida, o sino algumas
 * vezes por dia, o avatar é o menu que se procura.
 *
 * ⚠️ O alternador de tema saiu daqui e não foi para outro lugar: o produto tem
 * UM tema. Ver `app/layout.tsx`.
 */
export function HeaderActions() {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <SeletorDeIdioma />
      <AlertsBell />
      <ProfileMenu />
    </div>
  );
}
